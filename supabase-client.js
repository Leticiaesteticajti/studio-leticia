/**
 * js/supabase-client.js
 * Camada de integração com o Supabase para agendamento online em tempo real.
 * Inclui suporte a Realtime WebSockets e fallback automático 100% nativo via REST API (Fetch).
 */

// Chaves de configuração padrão (podem ser configuradas pelo painel de Ajustes ou aqui)
const DEFAULT_SUPABASE_CONFIG = {
  url: 'https://naxbtiyliiysojaiugzy.supabase.co',
  anonKey: 'sb_publishable_znWpnllBf3tHOWEVzxN-DA_C8m4sqjS'
};

class StudioCloudService {
  constructor() {
    this.client = null;
    this.init();
  }

  init() {
    const savedUrl = localStorage.getItem('studio_supabase_url') || DEFAULT_SUPABASE_CONFIG.url;
    const savedKey = localStorage.getItem('studio_supabase_key') || DEFAULT_SUPABASE_CONFIG.anonKey;

    const sbLib = (typeof window !== 'undefined' && window.supabase) || (typeof supabase !== 'undefined' ? supabase : null);

    if (sbLib && savedUrl && savedKey) {
      try {
        this.client = sbLib.createClient(savedUrl, savedKey);
      } catch (e) {
        console.warn('Erro ao inicializar Supabase Client via biblioteca:', e);
      }
    }
  }

  ensureClient() {
    if (!this.client) {
      this.init();
    }
    return this.client;
  }

  isConfigured() {
    const savedKey = localStorage.getItem('studio_supabase_key') || DEFAULT_SUPABASE_CONFIG.anonKey;
    return !!(savedKey && (savedKey.startsWith('sb_') || savedKey.startsWith('eyJ') || savedKey.length > 20));
  }

  // Executa requisições REST diretamente no Supabase (zero-dependência de biblioteca CDN)
  async _restFetch(endpoint, options = {}) {
    const savedUrl = localStorage.getItem('studio_supabase_url') || DEFAULT_SUPABASE_CONFIG.url;
    const savedKey = localStorage.getItem('studio_supabase_key') || DEFAULT_SUPABASE_CONFIG.anonKey;
    const url = `${savedUrl}/rest/v1/${endpoint}`;

    const headers = {
      'apikey': savedKey,
      'Authorization': `Bearer ${savedKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    return fetch(url, { ...options, headers });
  }

  // Busca catálogo de serviços disponíveis para a cliente agendar (Nuvem ou Local)
  async getPublicServices() {
    this.ensureClient();
    const defaultServices = [
      {
        id: 'srv_1',
        nome: 'Drenagem Linfática Corporal',
        categoria: 'Corporal',
        duracaoMin: 60,
        preco: 120.00,
        descricao: 'Redução de retenção de líquidos, desinchaço e ativação da circulação.'
      },
      {
        id: 'srv_2',
        nome: 'Drenagem Linfática Pré e Pós-Operatório',
        categoria: 'Corporal',
        duracaoMin: 60,
        preco: 130.00,
        descricao: 'Recuperação tecidual acelerada e redução de fibroses cirúrgicas.'
      },
      {
        id: 'srv_3',
        nome: 'Drenagem Linfática Método Renata França',
        categoria: 'Corporal',
        duracaoMin: 60,
        preco: 160.00,
        descricao: 'Toque diferenciado que resulta em efeito de lipoescultura manual imediata.'
      },
      {
        id: 'srv_4',
        nome: 'Massagem Modeladora Redutora',
        categoria: 'Corporal',
        duracaoMin: 60,
        preco: 140.00,
        descricao: 'Manobras vigorosas focadas em contorno corporal e celulite.'
      },
      {
        id: 'srv_5',
        nome: 'Massagem Relaxante com Aromaterapia',
        categoria: 'Corporal',
        duracaoMin: 50,
        preco: 120.00,
        descricao: 'Alívio de tensões musculares, estresse e relaxamento profundo.'
      },
      {
        id: 'srv_6',
        nome: 'Limpeza de Pele Profunda',
        categoria: 'Facial',
        duracaoMin: 75,
        preco: 150.00,
        descricao: 'Extração de cravos, esfoliação e hidratação com máscara calmante.'
      }
    ];

    // 1. Tenta buscar direto via REST com cache-busting (zero dependência de biblioteca e sem cache HTTP)
    try {
      const res = await this._restFetch(`solicitacoes_agendamento?cliente_nome=eq.__STUDIO_CONFIG_SERVICOS__&select=observacoes&order=updated_at.desc&limit=1&_t=${Date.now()}`, {
        cache: 'no-store'
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.length > 0 && data[0].observacoes) {
          const remoteServices = JSON.parse(data[0].observacoes);
          if (Array.isArray(remoteServices) && remoteServices.length > 0) {
            return remoteServices;
          }
        }
      }
    } catch (e) {
      console.warn('Falha REST getPublicServices:', e);
    }

    // 2. Fallback via Supabase Client
    if (this.client) {
      try {
        const { data, error } = await this.client
          .from('solicitacoes_agendamento')
          .select('observacoes')
          .eq('cliente_nome', '__STUDIO_CONFIG_SERVICOS__')
          .order('updated_at', { ascending: false })
          .limit(1);

        if (!error && data && data.length > 0 && data[0].observacoes) {
          const remoteServices = JSON.parse(data[0].observacoes);
          if (Array.isArray(remoteServices) && remoteServices.length > 0) {
            return remoteServices;
          }
        }
      } catch (err) {
        console.warn('Falha client getPublicServices:', err);
      }
    }

    return defaultServices;
  }

  // Sincroniza catálogo de procedimentos da Letícia para a nuvem
  async syncServicesCatalog(services) {
    this.ensureClient();
    if (!this.isConfigured() || !services || services.length === 0) return;
    const nowIso = new Date().toISOString();
    const payload = {
      cliente_nome: '__STUDIO_CONFIG_SERVICOS__',
      cliente_whatsapp: '00000000000',
      servico_id: 'catalog',
      servico_nome: 'Catálogo de Serviços',
      servico_preco: 0,
      duracao_min: 0,
      data: '2099-12-31',
      horario: '00:00',
      status: 'recusado',
      observacoes: JSON.stringify(services),
      updated_at: nowIso
    };

    let synced = false;

    // 1. Atualização direta via REST PATCH (100% garantido e sem travas)
    try {
      const res = await this._restFetch('solicitacoes_agendamento?cliente_nome=eq.__STUDIO_CONFIG_SERVICOS__', {
        method: 'PATCH',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          synced = true;
        }
      }
    } catch (e) {
      console.warn('Erro syncServicesCatalog REST PATCH:', e);
    }

    // 2. Se nenhuma linha existia para atualizar, insere nova linha via POST
    if (!synced) {
      try {
        const res = await this._restFetch('solicitacoes_agendamento', {
          method: 'POST',
          headers: { 'Prefer': 'return=representation' },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          synced = true;
        }
      } catch (e) {
        console.warn('Erro syncServicesCatalog REST POST:', e);
      }
    }

    // 3. Fallback adicional via client caso o REST tenha tido problema de rede
    if (!synced && this.client) {
      try {
        const { data: updated, error: updateErr } = await this.client
          .from('solicitacoes_agendamento')
          .update(payload)
          .eq('cliente_nome', '__STUDIO_CONFIG_SERVICOS__')
          .select('id');

        if (!updateErr && (!updated || updated.length === 0)) {
          await this.client
            .from('solicitacoes_agendamento')
            .insert([payload]);
        }
      } catch (e) {
        console.warn('Erro fallback syncServicesCatalog client:', e);
      }
    }
  }

  // Busca configuração de horários e dias de atendimento disponíveis
  async getPublicScheduleConfig() {
    this.ensureClient();
    const defaultConfig = {
      slots: ['08:00', '09:00', '10:00', '11:00', '13:30', '14:30', '15:30', '16:30', '17:30'],
      diasSemana: [1, 2, 3, 4, 5, 6] // 0=Dom, 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex, 6=Sáb
    };

    if (this.client) {
      try {
        const { data, error } = await this.client
          .from('solicitacoes_agendamento')
          .select('observacoes')
          .eq('cliente_nome', '__STUDIO_CONFIG_HORARIOS__')
          .order('updated_at', { ascending: false })
          .limit(1);

        if (!error && data && data.length > 0 && data[0].observacoes) {
          const remoteConfig = JSON.parse(data[0].observacoes);
          if (remoteConfig && Array.isArray(remoteConfig.slots) && remoteConfig.slots.length > 0) {
            return remoteConfig;
          }
        }
      } catch (err) {
        console.warn('Falha client getPublicScheduleConfig, tentando REST:', err);
      }
    }

    try {
      const res = await this._restFetch('solicitacoes_agendamento?cliente_nome=eq.__STUDIO_CONFIG_HORARIOS__&select=observacoes&order=updated_at.desc&limit=1');
      if (res.ok) {
        const data = await res.json();
        if (data && data.length > 0 && data[0].observacoes) {
          const remoteConfig = JSON.parse(data[0].observacoes);
          if (remoteConfig && Array.isArray(remoteConfig.slots) && remoteConfig.slots.length > 0) {
            return remoteConfig;
          }
        }
      }
    } catch (e) {
      console.warn('Falha REST getPublicScheduleConfig:', e);
    }

    try {
      const local = localStorage.getItem('studio_schedule_config');
      if (local) {
        const parsed = JSON.parse(local);
        if (parsed && Array.isArray(parsed.slots)) return parsed;
      }
    } catch (e) {}

    return defaultConfig;
  }

  // Sincroniza a configuração de horários e dias com o Supabase
  async syncScheduleConfig(config) {
    this.ensureClient();
    if (!config || !config.slots) return;
    try {
      localStorage.setItem('studio_schedule_config', JSON.stringify(config));
    } catch (e) {}

    if (!this.isConfigured()) return;
    const payload = {
      cliente_nome: '__STUDIO_CONFIG_HORARIOS__',
      cliente_whatsapp: '00000000000',
      servico_id: 'schedule_config',
      servico_nome: 'Configuração de Horários',
      servico_preco: 0,
      duracao_min: 0,
      data: '2099-12-31',
      horario: '00:00',
      status: 'recusado',
      observacoes: JSON.stringify(config),
      updated_at: new Date().toISOString()
    };

    if (this.client) {
      try {
        const { data: updated, error: updateErr } = await this.client
          .from('solicitacoes_agendamento')
          .update(payload)
          .eq('cliente_nome', '__STUDIO_CONFIG_HORARIOS__')
          .select('id');

        if (!updateErr && (!updated || updated.length === 0)) {
          await this.client
            .from('solicitacoes_agendamento')
            .insert([payload]);
        }
        return;
      } catch (e) {
        console.warn('Erro syncScheduleConfig client, tentando REST:', e);
      }
    }

    try {
      const res = await this._restFetch('solicitacoes_agendamento?cliente_nome=eq.__STUDIO_CONFIG_HORARIOS__', {
        method: 'PATCH',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!data || data.length === 0) {
        await this._restFetch('solicitacoes_agendamento', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }
    } catch (e) {
      console.warn('Erro ao sincronizar horários via REST:', e);
    }
  }

  // Bloqueia horário na nuvem quando a Letícia agenda pelo app
  async blockSlotOnCloud(agendamento) {
    if (!this.isConfigured() || !agendamento || !agendamento.data || !agendamento.horario) return;
    // NÃO sincronizar o agendamento de demonstração padrão (agd_demo_1) para não poluir o banco na nuvem
    if (agendamento.id === 'agd_demo_1' || agendamento.clienteNome === 'Amanda Caroline Costa') return;

    try {
      const requestData = {
        cliente_nome: agendamento.clienteNome || 'Atendimento Studio',
        cliente_whatsapp: (agendamento.whatsapp || '0000000000').replace(/\D/g, '') || '0000000000',
        servico_id: agendamento.servicoId || 'srv_app',
        servico_nome: agendamento.servicoNome || 'Procedimento Studio',
        servico_preco: Number(agendamento.valor) || 0,
        duracao_min: parseInt(agendamento.duracaoMin, 10) || 60,
        data: agendamento.data,
        horario: agendamento.horario,
        observacoes: `[APP_ID:${agendamento.id}]`,
        status: 'confirmado'
      };

      const busy = await this.getBusySlotsForDate(agendamento.data);
      if (busy.includes(agendamento.horario)) {
        return;
      }

      if (this.client) {
        await this.client.from('solicitacoes_agendamento').insert([requestData]);
      } else {
        await this._restFetch('solicitacoes_agendamento', {
          method: 'POST',
          body: JSON.stringify(requestData)
        });
      }
    } catch (e) {
      console.warn('Erro ao bloquear horário na nuvem:', e);
    }
  }

  // Desbloqueia horário na nuvem quando a Letícia remove pelo app
  async unblockSlotOnCloud(agendamento) {
    if (!this.isConfigured() || !agendamento) return;
    try {
      if (this.client) {
        await this.client
          .from('solicitacoes_agendamento')
          .delete()
          .eq('data', agendamento.data)
          .eq('horario', agendamento.horario)
          .ilike('observacoes', `%[APP_ID:${agendamento.id}]%`);
      } else {
        await this._restFetch(`solicitacoes_agendamento?data=eq.${agendamento.data}&horario=eq.${agendamento.horario}&observacoes=ilike.*[APP_ID:${agendamento.id}]*`, {
          method: 'DELETE'
        });
      }
    } catch (e) {
      console.warn('Erro ao desbloquear horário na nuvem:', e);
    }
  }

  // Sincroniza em lote todos os agendamentos futuros da Letícia
  async syncLocalAppointmentsToCloud(appointments) {
    if (!this.isConfigured() || !Array.isArray(appointments) || appointments.length === 0) return;
    const hoje = new Date().toISOString().split('T')[0];
    const futuros = appointments.filter(a => a.data >= hoje && a.status !== 'cancelado' && a.id !== 'agd_demo_1');
    for (const app of futuros) {
      await this.blockSlotOnCloud(app);
    }
  }

  // Busca horários já ocupados para a data selecionada
  async getBusySlotsForDate(dateStr) {
    if (!this.isConfigured()) return [];

    if (this.client) {
      try {
        const { data, error } = await this.client
          .from('solicitacoes_agendamento')
          .select('horario')
          .eq('data', dateStr)
          .in('status', ['confirmado', 'pendente']);

        if (!error && Array.isArray(data)) {
          return data.map(item => item.horario);
        }
      } catch (e) {
        console.warn('Erro getBusySlotsForDate client, tentando REST:', e);
      }
    }

    try {
      const res = await this._restFetch(`solicitacoes_agendamento?data=eq.${dateStr}&status=in.(confirmado,pendente)&select=horario`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          return data.map(item => item.horario);
        }
      }
    } catch (e) {
      console.warn('Falha REST getBusySlotsForDate:', e);
    }

    return [];
  }

  // Cria uma nova solicitação de agendamento feita pela cliente
  async createBookingRequest(requestData) {
    const payload = { ...requestData };
    if (payload.cliente_cpf && !String(payload.observacoes || '').includes('[CPF:')) {
      payload.observacoes = `[CPF:${payload.cliente_cpf}] ${payload.observacoes || ''}`.trim();
    }

    if (!this.isConfigured()) {
      const mockId = 'demo_' + Math.random().toString(36).substring(2, 9);
      const mockItem = { ...payload, id: mockId, created_at: new Date().toISOString() };
      const localList = JSON.parse(localStorage.getItem('studio_demo_requests') || '[]');
      localList.push(mockItem);
      localStorage.setItem('studio_demo_requests', JSON.stringify(localList));
      try { localStorage.setItem('studio_booking_' + mockId, JSON.stringify(mockItem)); } catch (_) {}
      return mockItem;
    }

    if (this.client) {
      try {
        const { data, error } = await this.client
          .from('solicitacoes_agendamento')
          .insert([payload])
          .select()
          .single();

        if (!error && data) {
          const resData = Array.isArray(data) ? data[0] : data;
          try { localStorage.setItem('studio_booking_' + resData.id, JSON.stringify(resData)); } catch (_) {}
          return resData;
        }
      } catch (err) {
        console.warn('Erro createBookingRequest client, tentando REST:', err);
      }
    }

    try {
      const res = await this._restFetch('solicitacoes_agendamento', {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const data = await res.json();
        const resData = Array.isArray(data) ? data[0] : data;
        try { localStorage.setItem('studio_booking_' + resData.id, JSON.stringify(resData)); } catch (_) {}
        return resData;
      }
    } catch (restErr) {
      console.error('Erro createBookingRequest REST:', restErr);
    }

    throw new Error('Falha ao registrar solicitação no servidor.');
  }

  // Busca todo o histórico recente de solicitações (Confirmadas, Pendentes, Recusadas)
  async getAllRequests(limit = 40) {
    this.ensureClient();

    // 1. Tenta via Supabase Client com filtro SQL para não puxar slots de bloqueio
    if (this.client) {
      try {
        const { data, error } = await this.client
          .from('solicitacoes_agendamento')
          .select('*')
          .neq('cliente_nome', '__STUDIO_CONFIG_SERVICOS__')
          .neq('cliente_nome', '__STUDIO_CONFIG_HORARIOS__')
          .not('observacoes', 'ilike', '%[APP_ID:%')
          .order('created_at', { ascending: false })
          .limit(limit);

        if (!error && Array.isArray(data)) {
          return data.filter(item => !item.observacoes || !item.observacoes.includes('[APP_ID:'));
        }
      } catch (e) {
        console.warn('Falha getAllRequests client, tentando REST:', e);
      }
    }

    // 2. Fallback REST direto
    try {
      const res = await this._restFetch(`solicitacoes_agendamento?select=*&cliente_nome=neq.__STUDIO_CONFIG_SERVICOS__&cliente_nome=neq.__STUDIO_CONFIG_HORARIOS__&observacoes=not.ilike.*[APP_ID:*&order=created_at.desc&limit=${limit}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          return data.filter(item => !item.observacoes || !item.observacoes.includes('[APP_ID:'));
        }
      }
    } catch (e) {
      console.warn('Falha getAllRequests REST:', e);
    }

    const localList = JSON.parse(localStorage.getItem('studio_demo_requests') || '[]');
    return localList.filter(item => !item.observacoes || !item.observacoes.includes('[APP_ID:')).slice(0, limit);
  }

  // Acompanhamento do status pelo link da cliente (GET por ID) com robustez
  async getBookingRequestById(id) {
    if (!id) return null;

    let localItem = null;
    try {
      const cached = localStorage.getItem('studio_booking_' + id);
      if (cached) localItem = JSON.parse(cached);
    } catch (_) {}

    // 1. Tenta via Client
    if (this.client) {
      try {
        const { data, error } = await this.client
          .from('solicitacoes_agendamento')
          .select('*')
          .eq('id', id)
          .maybeSingle();

        if (!error && data) {
          let cleanData = Array.isArray(data) ? data[0] : data;
          if (cleanData && cleanData.data && typeof cleanData.data === 'object' && !cleanData.cliente_nome) {
            cleanData = cleanData.data;
          }
          try { localStorage.setItem('studio_booking_' + id, JSON.stringify(cleanData)); } catch (_) {}
          return cleanData;
        }
      } catch (e) {
        console.warn('Erro getBookingRequestById client, tentando REST:', e);
      }
    }

    // 2. Fallback REST direto
    try {
      const res = await this._restFetch(`solicitacoes_agendamento?id=eq.${id}&select=*`);
      if (res.ok) {
        const list = await res.json();
        if (Array.isArray(list) && list.length > 0) {
          const item = list[0];
          try { localStorage.setItem('studio_booking_' + id, JSON.stringify(item)); } catch (_) {}
          return item;
        }
      }
    } catch (restErr) {
      console.warn('Erro getBookingRequestById REST:', restErr);
    }

    const localList = JSON.parse(localStorage.getItem('studio_demo_requests') || '[]');
    return localList.find(item => item.id === id) || localItem || null;
  }

  // Assinatura Realtime para a Letícia receber novos pedidos instantaneamente
  subscribeToNewBookings(callback) {
    this.ensureClient();
    if (!this.client || typeof this.client.channel !== 'function') return null;
    try {
      const channel = this.client
        .channel('realtime_novas_solicitacoes_' + Date.now())
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'solicitacoes_agendamento' },
          (payload) => {
            if (payload && payload.new) {
              callback(payload.new);
            }
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log('📡 Realtime de agendamentos conectado com sucesso!');
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            console.warn(`⚠️ Realtime de novos agendamentos desconectado (${status}).`);
          }
        });
      return channel;
    } catch (e) {
      console.warn('Falha ao conectar Realtime de novos agendamentos:', e);
      return null;
    }
  }

  // Assinatura Realtime para a tela da cliente atualizar no milissegundo em que a Letícia aprova
  subscribeToBookingStatus(requestId, callback) {
    this.ensureClient();
    if (!this.client || !requestId || typeof this.client.channel !== 'function') return null;
    try {
      const channel = this.client
        .channel('realtime_status_solicitacao_' + requestId)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'solicitacoes_agendamento',
            filter: `id=eq.${requestId}`
          },
          (payload) => {
            if (payload && payload.new) {
              callback(payload.new);
            }
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log('📡 Realtime de status da solicitação conectado com sucesso!');
          }
        });
      return channel;
    } catch (e) {
      console.warn('Falha ao conectar Realtime de status:', e);
      return null;
    }
  }

  unsubscribe(channel) {
    if (this.client && channel && typeof this.client.removeChannel === 'function') {
      try {
        this.client.removeChannel(channel);
      } catch (_) {}
    }
  }

  // Busca solicitações pendentes para a Letícia aprovar no app
  async getPendingRequests() {
    this.ensureClient();

    // 1. Tenta via Supabase JS Client com filtro SQL
    if (this.client) {
      try {
        const { data, error } = await this.client
          .from('solicitacoes_agendamento')
          .select('*')
          .eq('status', 'pendente')
          .neq('cliente_nome', '__STUDIO_CONFIG_SERVICOS__')
          .neq('cliente_nome', '__STUDIO_CONFIG_HORARIOS__')
          .not('observacoes', 'ilike', '%[APP_ID:%')
          .order('created_at', { ascending: false });

        if (!error && Array.isArray(data)) {
          return data.filter(item => !item.observacoes || !item.observacoes.includes('[APP_ID:'));
        }
      } catch (e) {
        console.warn('Erro getPendingRequests via client, tentando REST direto:', e);
      }
    }

    // 2. Fallback REST nativo direto (100% confiável)
    try {
      const res = await this._restFetch('solicitacoes_agendamento?status=eq.pendente&cliente_nome=neq.__STUDIO_CONFIG_SERVICOS__&cliente_nome=neq.__STUDIO_CONFIG_HORARIOS__&observacoes=not.ilike.*[APP_ID:*&order=created_at.desc');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          return data.filter(item => !item.observacoes || !item.observacoes.includes('[APP_ID:'));
        }
      }
    } catch (restErr) {
      console.warn('Erro getPendingRequests via REST:', restErr);
    }

    // 3. Fallback demo local se estiver offline
    const localList = JSON.parse(localStorage.getItem('studio_demo_requests') || '[]');
    return localList.filter(item => item.status === 'pendente' && (!item.observacoes || !item.observacoes.includes('[APP_ID:')));
  }

  // Letícia confirma a solicitação
  async confirmBooking(requestId) {
    this.ensureClient();
    const payload = { status: 'confirmado', updated_at: new Date().toISOString() };

    // 1. Tenta via Client
    if (this.client) {
      try {
        const { data, error } = await this.client
          .from('solicitacoes_agendamento')
          .update(payload)
          .eq('id', requestId)
          .select();

        if (!error) {
          const resItem = (data && data.length > 0) ? data[0] : { id: requestId, status: 'confirmado' };
          try { localStorage.setItem('studio_booking_' + requestId, JSON.stringify(resItem)); } catch (_) {}
          return resItem;
        }
      } catch (e) {
        console.warn('Erro confirmBooking client, tentando REST:', e);
      }
    }

    // 2. Fallback REST direto
    try {
      const res = await this._restFetch(`solicitacoes_agendamento?id=eq.${requestId}`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const data = await res.json();
        const resItem = (data && data.length > 0) ? data[0] : { id: requestId, status: 'confirmado' };
        try { localStorage.setItem('studio_booking_' + requestId, JSON.stringify(resItem)); } catch (_) {}
        return resItem;
      }
    } catch (restErr) {
      console.warn('Erro confirmBooking REST:', restErr);
    }

    const localList = JSON.parse(localStorage.getItem('studio_demo_requests') || '[]');
    const item = localList.find(i => i.id === requestId);
    if (item) item.status = 'confirmado';
    localStorage.setItem('studio_demo_requests', JSON.stringify(localList));
    return item || { id: requestId, status: 'confirmado' };
  }

  // Letícia ajusta o horário (encaixe) e confirma a solicitação
  async rescheduleAndConfirmBooking(requestId, novaData, novoHorario, motivo = '') {
    this.ensureClient();
    const cleanMotivo = motivo ? motivo.trim() : '';
    const encaixeTag = `[ENCAIXE_HORARIO: ${novaData} ${novoHorario}] ${cleanMotivo}`.trim();

    let currentObs = '';
    const existing = await this.getBookingRequestById(requestId);
    if (existing && existing.observacoes) {
      currentObs = existing.observacoes;
    }
    const updatedObs = currentObs ? `${currentObs} | ${encaixeTag}` : encaixeTag;

    const payload = {
      data: novaData,
      horario: novoHorario,
      status: 'confirmado',
      observacoes: updatedObs,
      updated_at: new Date().toISOString()
    };

    // 1. Tenta via Client
    if (this.client) {
      try {
        const { data, error } = await this.client
          .from('solicitacoes_agendamento')
          .update(payload)
          .eq('id', requestId)
          .select();

        if (!error) {
          const resItem = (data && data.length > 0) ? data[0] : { id: requestId, ...payload };
          try { localStorage.setItem('studio_booking_' + requestId, JSON.stringify(resItem)); } catch (_) {}
          return resItem;
        }
      } catch (e) {
        console.warn('Erro rescheduleAndConfirmBooking client, tentando REST:', e);
      }
    }

    // 2. Fallback REST direto
    try {
      const res = await this._restFetch(`solicitacoes_agendamento?id=eq.${requestId}`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const data = await res.json();
        const resItem = (data && data.length > 0) ? data[0] : { id: requestId, ...payload };
        try { localStorage.setItem('studio_booking_' + requestId, JSON.stringify(resItem)); } catch (_) {}
        return resItem;
      }
    } catch (restErr) {
      console.warn('Erro rescheduleAndConfirmBooking REST:', restErr);
    }

    const localList = JSON.parse(localStorage.getItem('studio_demo_requests') || '[]');
    const item = localList.find(i => i.id === requestId);
    if (item) {
      item.data = novaData;
      item.horario = novoHorario;
      item.status = 'confirmado';
      item.observacoes = updatedObs;
    }
    localStorage.setItem('studio_demo_requests', JSON.stringify(localList));
    return item || { id: requestId, ...payload };
  }

  // Letícia recusa a solicitação
  async rejectBooking(requestId, motivo = '') {
    this.ensureClient();
    const payload = {
      status: 'recusado',
      motivo_recusa: motivo,
      updated_at: new Date().toISOString()
    };

    // 1. Tenta via Client
    if (this.client) {
      try {
        const { data, error } = await this.client
          .from('solicitacoes_agendamento')
          .update(payload)
          .eq('id', requestId)
          .select();

        if (!error) {
          const resItem = (data && data.length > 0) ? data[0] : { id: requestId, ...payload };
          try { localStorage.setItem('studio_booking_' + requestId, JSON.stringify(resItem)); } catch (_) {}
          return resItem;
        }
      } catch (e) {
        console.warn('Erro rejectBooking client, tentando REST:', e);
      }
    }

    // 2. Fallback REST direto
    try {
      const res = await this._restFetch(`solicitacoes_agendamento?id=eq.${requestId}`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const data = await res.json();
        const resItem = (data && data.length > 0) ? data[0] : { id: requestId, ...payload };
        try { localStorage.setItem('studio_booking_' + requestId, JSON.stringify(resItem)); } catch (_) {}
        return resItem;
      }
    } catch (restErr) {
      console.warn('Erro rejectBooking REST:', restErr);
    }

    const localList = JSON.parse(localStorage.getItem('studio_demo_requests') || '[]');
    const item = localList.find(i => i.id === requestId);
    if (item) {
      item.status = 'recusado';
      item.motivo_recusa = motivo;
    }
    localStorage.setItem('studio_demo_requests', JSON.stringify(localList));
    return item || { id: requestId, ...payload };
  }
}

// Instância global
const StudioCloud = new StudioCloudService();
if (typeof window !== 'undefined') {
  window.StudioCloud = StudioCloud;
}
