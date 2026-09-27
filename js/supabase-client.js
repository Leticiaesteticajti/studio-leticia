/**
 * js/supabase-client.js
 * Camada de integração com o Supabase para agendamento online em tempo real.
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

    if (window.supabase && savedUrl && savedKey) {
      try {
        this.client = window.supabase.createClient(savedUrl, savedKey);
      } catch (e) {
        console.warn('Erro ao inicializar Supabase Client:', e);
      }
    }
  }

  isConfigured() {
    const savedKey = localStorage.getItem('studio_supabase_key') || DEFAULT_SUPABASE_CONFIG.anonKey;
    return !!(this.client && savedKey && (savedKey.startsWith('sb_') || savedKey.startsWith('eyJ') || savedKey.length > 20));
  }

  // Busca catálogo de serviços disponíveis para a cliente agendar (Nuvem ou Local)
  async getPublicServices() {
    const defaultServices = [
      {
        id: 'srv_1',
        nome: 'Drenagem Linfática Corporal',
        duracaoMin: 60,
        preco: 130.00,
        descricao: 'Redução de retenção de líquidos, desinchaço e ativação da circulação.'
      },
      {
        id: 'srv_2',
        nome: 'Drenagem Linfática Facial',
        duracaoMin: 40,
        preco: 90.00,
        descricao: 'Diminuição de bolsas nos olhos, linhas de expressão e efeito lifting.'
      },
      {
        id: 'srv_3',
        nome: 'Drenagem Linfática Pós-Operatório',
        duracaoMin: 60,
        preco: 160.00,
        descricao: 'Recuperação cirúrgica com toques suaves para alívio de dor e fibroses.'
      },
      {
        id: 'srv_4',
        nome: 'Massagem Relaxante com Óleos',
        duracaoMin: 60,
        preco: 120.00,
        descricao: 'Alívio profundo de tensões musculares, estresse e renovação de energias.'
      }
    ];

    // 1. Tenta buscar catálogo sincronizado da Letícia na nuvem (Supabase)
    if (this.isConfigured()) {
      try {
        const { data, error } = await this.client
          .from('solicitacoes_agendamento')
          .select('observacoes')
          .eq('cliente_nome', '__STUDIO_CONFIG_SERVICOS__')
          .limit(1);

        if (!error && data && data.length > 0 && data[0].observacoes) {
          const remoteServices = JSON.parse(data[0].observacoes);
          if (Array.isArray(remoteServices) && remoteServices.length > 0) {
            return remoteServices;
          }
        }
      } catch (err) {
        console.warn('Falha ao obter catálogo remoto:', err);
      }
    }

    // 2. Fallback: Se for a própria Letícia com IndexedDB local ativo
    try {
      if (typeof db !== 'undefined' && db && db.getAll) {
        const localServices = await db.getAll('servicos');
        if (localServices && localServices.length > 0) {
          return localServices;
        }
      }
    } catch (e) {
      // Ignora e usa catálogo padrão
    }

    return defaultServices;
  }

  // Sincroniza catálogo de procedimentos da Letícia para a nuvem
  async syncServicesCatalog(services) {
    if (!this.isConfigured() || !services || services.length === 0) return;
    try {
      const { data: existing } = await this.client
        .from('solicitacoes_agendamento')
        .select('id')
        .eq('cliente_nome', '__STUDIO_CONFIG_SERVICOS__')
        .limit(1);

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
        updated_at: new Date().toISOString()
      };

      if (existing && existing.length > 0) {
        await this.client
          .from('solicitacoes_agendamento')
          .update(payload)
          .eq('id', existing[0].id);
      } else {
        await this.client
          .from('solicitacoes_agendamento')
          .insert([payload]);
      }
    } catch (e) {
      console.warn('Erro ao sincronizar catálogo no Supabase:', e);
    }
  }

  // Bloqueia horário na nuvem quando a Letícia agenda pelo app
  async blockSlotOnCloud(agendamento) {
    if (!this.isConfigured() || !agendamento || !agendamento.data || !agendamento.horario) return;
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

      const { data: existing } = await this.client
        .from('solicitacoes_agendamento')
        .select('id')
        .eq('data', agendamento.data)
        .eq('horario', agendamento.horario)
        .in('status', ['confirmado', 'pendente'])
        .limit(1);

      if (!existing || existing.length === 0) {
        await this.client.from('solicitacoes_agendamento').insert([requestData]);
      }
    } catch (e) {
      console.warn('Erro ao bloquear horário na nuvem:', e);
    }
  }

  // Desbloqueia horário na nuvem quando a Letícia remove pelo app
  async unblockSlotOnCloud(agendamento) {
    if (!this.isConfigured() || !agendamento) return;
    try {
      await this.client
        .from('solicitacoes_agendamento')
        .delete()
        .eq('data', agendamento.data)
        .eq('horario', agendamento.horario)
        .ilike('observacoes', `%[APP_ID:${agendamento.id}]%`);
    } catch (e) {
      console.warn('Erro ao desbloquear horário na nuvem:', e);
    }
  }

  // Sincroniza em lote todos os agendamentos futuros da Letícia
  async syncLocalAppointmentsToCloud(appointments) {
    if (!this.isConfigured() || !Array.isArray(appointments) || appointments.length === 0) return;
    const hoje = new Date().toISOString().split('T')[0];
    const futuros = appointments.filter(a => a.data >= hoje && a.status !== 'cancelado');
    for (const app of futuros) {
      await this.blockSlotOnCloud(app);
    }
  }

  // Busca horários já ocupados para a data selecionada
  async getBusySlotsForDate(dateStr) {
    if (!this.isConfigured()) {
      // Sem Supabase configurado, retorna slots ocupados simulados/vazios
      return [];
    }

    try {
      // 1. Busca agendamentos já confirmados no Supabase
      const { data, error } = await this.client
        .from('solicitacoes_agendamento')
        .select('horario')
        .eq('data', dateStr)
        .in('status', ['confirmado', 'pendente']);

      if (error) {
        console.warn('Erro ao consultar horários ocupados:', error);
        return [];
      }

      return (data || []).map(item => item.horario);
    } catch (e) {
      console.warn('Falha na consulta de horários:', e);
      return [];
    }
  }

  // Cria uma nova solicitação de agendamento feita pela cliente
  async createBookingRequest(requestData) {
    // Garante que o CPF fica preservado em observacoes como fallback de schema
    const payload = { ...requestData };
    if (payload.cliente_cpf && !String(payload.observacoes || '').includes('[CPF:')) {
      payload.observacoes = `[CPF:${payload.cliente_cpf}] ${payload.observacoes || ''}`.trim();
    }

    if (!this.isConfigured()) {
      // Modo Demonstração / Local (caso Supabase ainda não tenha chaves preenchidas)
      const mockId = 'demo_' + Math.random().toString(36).substring(2, 9);
      const mockItem = {
        ...payload,
        id: mockId,
        created_at: new Date().toISOString()
      };
      
      const localList = JSON.parse(localStorage.getItem('studio_demo_requests') || '[]');
      localList.push(mockItem);
      localStorage.setItem('studio_demo_requests', JSON.stringify(localList));

      return mockItem;
    }

    try {
      // Tenta inserir primeiro com todos os campos (inclusive cliente_cpf se existir na tabela)
      const { data, error } = await this.client
        .from('solicitacoes_agendamento')
        .insert([payload])
        .select()
        .single();

      if (error) {
        // Se a coluna cliente_cpf ainda não existir no schema remoto, tenta sem a coluna
        if (error.message && error.message.includes('cliente_cpf')) {
          const { cliente_cpf, ...fallbackPayload } = payload;
          const retry = await this.client
            .from('solicitacoes_agendamento')
            .insert([fallbackPayload])
            .select()
            .single();
          if (retry.error) throw retry.error;
          return retry.data;
        }
        console.error('Erro ao inserir solicitação:', error);
        throw error;
      }

      return data;
    } catch (err) {
      console.error('Erro createBookingRequest:', err);
      throw err;
    }
  }

  // Busca todo o histórico recente de solicitações (Confirmadas, Pendentes, Recusadas)
  async getAllRequests(limit = 40) {
    if (!this.isConfigured()) {
      const localList = JSON.parse(localStorage.getItem('studio_demo_requests') || '[]');
      return localList.slice(0, limit);
    }

    try {
      const { data, error } = await this.client
        .from('solicitacoes_agendamento')
        .select('*')
        .neq('cliente_nome', '__STUDIO_CONFIG_SERVICOS__')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.warn('Erro getAllRequests:', error);
        return [];
      }
      return data || [];
    } catch (e) {
      console.warn('Falha getAllRequests:', e);
      return [];
    }
  }

  // Acompanhamento do status pelo link da cliente (GET por ID)
  async getBookingRequestById(id) {
    if (!this.isConfigured()) {
      const localList = JSON.parse(localStorage.getItem('studio_demo_requests') || '[]');
      return localList.find(item => item.id === id) || null;
    }

    try {
      const { data, error } = await this.client
        .from('solicitacoes_agendamento')
        .select('*')
        .eq('id', id)
        .single();

      if (error) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  // Busca solicitações pendentes para a Letícia aprovar no app
  async getPendingRequests() {
    if (!this.isConfigured()) {
      const localList = JSON.parse(localStorage.getItem('studio_demo_requests') || '[]');
      return localList.filter(item => item.status === 'pendente');
    }

    try {
      const { data, error } = await this.client
        .from('solicitacoes_agendamento')
        .select('*')
        .eq('status', 'pendente')
        .order('created_at', { ascending: false });

      if (error) {
        console.warn('Erro getPendingRequests:', error);
        return [];
      }
      return data || [];
    } catch (e) {
      console.warn('Falha getPendingRequests:', e);
      return [];
    }
  }

  // Letícia confirma a solicitação
  async confirmBooking(requestId) {
    if (!this.isConfigured()) {
      const localList = JSON.parse(localStorage.getItem('studio_demo_requests') || '[]');
      const item = localList.find(i => i.id === requestId);
      if (item) item.status = 'confirmado';
      localStorage.setItem('studio_demo_requests', JSON.stringify(localList));
      return item;
    }

    try {
      const { data, error } = await this.client
        .from('solicitacoes_agendamento')
        .update({ status: 'confirmado', updated_at: new Date().toISOString() })
        .eq('id', requestId)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (e) {
      console.error('Erro confirmBooking:', e);
      throw e;
    }
  }

  // Letícia recusa a solicitação
  async rejectBooking(requestId, motivo = '') {
    if (!this.isConfigured()) {
      const localList = JSON.parse(localStorage.getItem('studio_demo_requests') || '[]');
      const item = localList.find(i => i.id === requestId);
      if (item) {
        item.status = 'recusado';
        item.motivo_recusa = motivo;
      }
      localStorage.setItem('studio_demo_requests', JSON.stringify(localList));
      return item;
    }

    try {
      const { data, error } = await this.client
        .from('solicitacoes_agendamento')
        .update({ 
          status: 'recusado', 
          motivo_recusa: motivo, 
          updated_at: new Date().toISOString() 
        })
        .eq('id', requestId)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (e) {
      console.error('Erro rejectBooking:', e);
      throw e;
    }
  }
}

// Instância global
const StudioCloud = new StudioCloudService();
if (typeof window !== 'undefined') {
  window.StudioCloud = StudioCloud;
}
