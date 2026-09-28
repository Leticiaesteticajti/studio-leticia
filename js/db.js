/**
 * db.js - Camada de Banco de Dados Local (IndexedDB)
 * 100% no dispositivo, offline, sem servidores e com backup/restore.
 */

const DB_NAME = 'StudioLeticiaDB';
const DB_VERSION = 2;

class LocalDatabase {
  constructor() {
    this.db = null;
    this.initPromise = this.init();
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Tabela de Clientes
        if (!db.objectStoreNames.contains('clientes')) {
          const storeClientes = db.createObjectStore('clientes', { keyPath: 'id' });
          storeClientes.createIndex('nome', 'nome', { unique: false });
          storeClientes.createIndex('whatsapp', 'whatsapp', { unique: false });
          storeClientes.createIndex('cpf', 'cpf', { unique: false });
        }

        // Tabela de Procedimentos e Serviços
        if (!db.objectStoreNames.contains('servicos')) {
          db.createObjectStore('servicos', { keyPath: 'id' });
        }

        // Tabela de Catálogo de Planos e Pacotes de Tratamento
        if (!db.objectStoreNames.contains('catalogo_pacotes')) {
          db.createObjectStore('catalogo_pacotes', { keyPath: 'id' });
        }

        // Tabela de Agendamentos
        if (!db.objectStoreNames.contains('agendamentos')) {
          const storeAgendamentos = db.createObjectStore('agendamentos', { keyPath: 'id' });
          storeAgendamentos.createIndex('data', 'data', { unique: false });
          storeAgendamentos.createIndex('clienteId', 'clienteId', { unique: false });
          storeAgendamentos.createIndex('status', 'status', { unique: false });
        }

        // Tabela de Transações Financeiras (Fluxo de Caixa)
        if (!db.objectStoreNames.contains('transacoes')) {
          const storeTransacoes = db.createObjectStore('transacoes', { keyPath: 'id' });
          storeTransacoes.createIndex('data', 'data', { unique: false });
          storeTransacoes.createIndex('tipo', 'tipo', { unique: false });
        }

        // Tabela de Configurações
        if (!db.objectStoreNames.contains('config')) {
          db.createObjectStore('config', { keyPath: 'id' });
        }
      };

      request.onsuccess = async (event) => {
        this.db = event.target.result;
        resolve(this.db);
        try {
          await this.seedDefaultData();
        } catch (err) {
          console.warn('Aviso no seed inicial:', err);
        }
      };

      request.onerror = (event) => {
        console.error('Erro ao abrir IndexedDB:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  async ready() {
    if (this.db) return this.db;
    return this.initPromise;
  }

  // Popula dados iniciais caso o banco esteja vazio
  async seedDefaultData() {
    const servicos = await this.getAll('servicos');
    if (servicos.length === 0) {
      const servicosIniciais = [
        {
          id: 'srv_1',
          nome: 'Drenagem Linfática Corporal',
          categoria: 'Corporal',
          duracaoMin: 60,
          preco: 130.00,
          isPacote: false,
          descricao: 'Redução de retenção de líquidos, desinchaço e ativação da circulação.'
        },
        {
          id: 'srv_2',
          nome: 'Drenagem Linfática Facial',
          categoria: 'Facial',
          duracaoMin: 40,
          preco: 90.00,
          isPacote: false,
          descricao: 'Revitalização facial, redução de olheiras e bolsas, efeito lifting.'
        },
        {
          id: 'srv_3',
          nome: 'Drenagem Linfática Pós-Operatório',
          categoria: 'Corporal',
          duracaoMin: 60,
          preco: 160.00,
          isPacote: false,
          descricao: 'Atendimento especializado para pós-cirúrgico com toque suave e prevenção de fibroses.'
        },
        {
          id: 'srv_4',
          nome: 'Massagem Modeladora Redutora',
          categoria: 'Corporal',
          duracaoMin: 60,
          preco: 140.00,
          isPacote: false,
          descricao: 'Manobras vigorosas focadas em contorno corporal e celulite.'
        },
        {
          id: 'srv_5',
          nome: 'Massagem Relaxante com Aromaterapia',
          categoria: 'Corporal',
          duracaoMin: 50,
          preco: 120.00,
          isPacote: false,
          descricao: 'Alívio de tensões musculares, estresse e relaxamento profundo.'
        },
        {
          id: 'srv_6',
          nome: 'Limpeza de Pele Profunda',
          categoria: 'Facial',
          duracaoMin: 75,
          preco: 150.00,
          isPacote: false,
          descricao: 'Extração de cravos, esfoliação e hidratação com máscara calmante.'
        },
        {
          id: 'srv_7',
          nome: 'Pacote Drenagem Corporal (5 Sessões)',
          categoria: 'Pacotes',
          duracaoMin: 60,
          preco: 580.00,
          isPacote: true,
          qtdSessoes: 5,
          descricao: 'Plano com 5 sessões de drenagem linfática corporal.'
        },
        {
          id: 'srv_8',
          nome: 'Pacote Drenagem Corporal (10 Sessões)',
          categoria: 'Pacotes',
          duracaoMin: 60,
          preco: 1050.00,
          isPacote: true,
          qtdSessoes: 10,
          descricao: 'Plano intensivo com 10 sessões de drenagem linfática corporal.'
        }
      ];

      for (const s of servicosIniciais) {
        await this.put('servicos', s);
      }
    }

    // Catálogo inicial de Planos & Pacotes de Tratamento
    const catalogo = await this.getAll('catalogo_pacotes');
    if (catalogo.length === 0) {
      const pacotesPadrao = [
        {
          id: 'pct_cat_1',
          nome: 'Plano Mensal Drenagem (3 Sessões)',
          servicoNome: 'Drenagem Linfática Corporal',
          servicosNomes: ['Drenagem Linfática Corporal'],
          qtdSessoes: 3,
          validadeDias: 30,
          frequenciaTexto: '3 sessões no mês',
          preco: 340.00,
          descricao: 'Plano recorrente para desinchaço e manutenção corporal.'
        },
        {
          id: 'pct_cat_2',
          nome: 'Pacote Drenagem Corporal (5 Sessões)',
          servicoNome: 'Drenagem Linfática Corporal',
          servicosNomes: ['Drenagem Linfática Corporal'],
          qtdSessoes: 5,
          validadeDias: 60,
          frequenciaTexto: '5 sessões (validade 60 dias)',
          preco: 580.00,
          descricao: 'Tratamento contínuo focado em retenção hídrica.'
        },
        {
          id: 'pct_cat_3',
          nome: 'Pacote Drenagem Corporal (10 Sessões)',
          servicoNome: 'Drenagem Linfática Corporal',
          servicosNomes: ['Drenagem Linfática Corporal'],
          qtdSessoes: 10,
          validadeDias: 90,
          frequenciaTexto: '10 sessões (validade 90 dias)',
          preco: 1050.00,
          descricao: 'Protocolo intensivo com máximo resultado corporal.'
        },
        {
          id: 'pct_cat_4',
          nome: 'Protocolo Pós-Operatório (10 Sessões)',
          servicoNome: 'Drenagem Linfática Pós-Operatório',
          servicosNomes: ['Drenagem Linfática Pós-Operatório'],
          qtdSessoes: 10,
          validadeDias: 60,
          frequenciaTexto: '10 sessões especializadas',
          preco: 1450.00,
          descricao: 'Cuidado completo para prevenção de fibroses e recuperação rápida.'
        }
      ];

      for (const p of pacotesPadrao) {
        await this.put('catalogo_pacotes', p);
      }
    }

    // Configuração inicial padrão
    const config = await this.get('config', 'app_config');
    if (!config) {
      await this.put('config', {
        id: 'app_config',
        studioNome: 'Studio Letícia',
        profissionalNome: 'Letícia',
        whatsappStudio: '6493094775',
        studioAddress: 'Rua 26, nº 135 • Colmeia Park • Jataí - GO',
        dominio: 'estudioleticiaestetica.com.br',
        chavePix: '',
        authCpf: '',
        authSenha: 'LETICIA123',
        msgLembretePadrao: 'Olá, {nome}! ✨ Passando para confirmar seu horário de {servico} com a Letícia no dia {data} às {horario}. Podemos confirmar? Te espero com carinho! 💆‍♀️'
      });
    } else {
      let needsUpdate = false;
      if (!config.authSenha) {
        config.authSenha = 'LETICIA123';
        needsUpdate = true;
      }
      if (config.authCpf === undefined) {
        config.authCpf = '';
        needsUpdate = true;
      }
      if (!config.whatsappStudio || config.whatsappStudio === '') {
        config.whatsappStudio = '6493094775';
        needsUpdate = true;
      }
      if (!config.studioAddress) {
        config.studioAddress = 'Rua 26, nº 135 • Colmeia Park • Jataí - GO';
        needsUpdate = true;
      }
      if (!config.dominio) {
        config.dominio = 'estudioleticiaestetica.com.br';
        needsUpdate = true;
      }
      if (needsUpdate) {
        await this.put('config', config);
      }
    }

    // Cria cliente de demonstração se não houver clientes
    const clientes = await this.getAll('clientes');
    if (clientes.length === 0) {
      const clienteDemo = {
        id: 'cli_demo_1',
        nome: 'Amanda Caroline Costa',
        whatsapp: '11999998888',
        peso: '64.5',
        preferenciaSessao: 'Com música relaxante',
        notas: 'Gosta de atendimento no final da tarde. Prefere música relaxante de fundo.',
        anamnese: {
          queixaPrincipal: 'Retenção de líquido nas pernas e inchaço no abdômen.',
          cirurgiaRecente: 'Lipoescultura realizada há 4 meses com boa cicatrização.',
          alergias: 'Sem alergias a cremes conhecidas.',
          restricoes: 'Nenhuma contraindicação médica.',
          peso: '64.5',
          gestante: false,
          trombose: false
        },
        pacotes: [
          {
            id: 'pct_demo_1',
            servicoNome: 'Pacote Drenagem Corporal (5 Sessões)',
            totalSessoes: 5,
            sessoesFeitas: 2,
            valorTotal: 580.00,
            status: 'ativo',
            criadoEm: new Date().toISOString()
          }
        ],
        criadoEm: new Date().toISOString()
      };
      await this.put('clientes', clienteDemo);

      // Agendamento de hoje para demonstração
      const hojeStr = new Date().toISOString().split('T')[0];
      const agendamentoDemo = {
        id: 'agd_demo_1',
        clienteId: clienteDemo.id,
        clienteNome: clienteDemo.nome,
        whatsapp: clienteDemo.whatsapp,
        servicoId: 'srv_1',
        servicoNome: 'Drenagem Linfática Corporal',
        data: hojeStr,
        horario: '14:30',
        duracaoMin: 60,
        valor: 130.00,
        status: 'agendado',
        formaPagamento: null,
        pago: false,
        pacoteId: 'pct_demo_1',
        numSessao: 3,
        notas: 'Sessão 3 de 5 do pacote.'
      };
      await this.put('agendamentos', agendamentoDemo);
    }
  }

  // Métodos CRUD genéricos
  async getAll(storeName) {
    await this.ready();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async get(storeName, id) {
    await this.ready();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async put(storeName, item) {
    await this.ready();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put(item);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async delete(storeName, id) {
    await this.ready();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(id);

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  async getByIndex(storeName, indexName, value) {
    await this.ready();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const index = store.index(indexName);
      const request = index.getAll(value);

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  // Backup Completo dos Dados em JSON
  async exportAll() {
    await this.ready();
    const data = {
      version: DB_VERSION,
      exportDate: new Date().toISOString(),
      clientes: await this.getAll('clientes'),
      servicos: await this.getAll('servicos'),
      catalogo_pacotes: await this.getAll('catalogo_pacotes'),
      agendamentos: await this.getAll('agendamentos'),
      transacoes: await this.getAll('transacoes'),
      config: await this.getAll('config')
    };
    return JSON.stringify(data, null, 2);
  }

  // Restaurar Backup a partir de JSON
  async importAll(jsonString) {
    await this.ready();
    const data = JSON.parse(jsonString);

    const stores = ['clientes', 'servicos', 'catalogo_pacotes', 'agendamentos', 'transacoes', 'config'];
    for (const storeName of stores) {
      if (data[storeName] && Array.isArray(data[storeName])) {
        const tx = this.db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.clear();
        for (const item of data[storeName]) {
          store.put(item);
        }
      }
    }
    return true;
  }
}

// Instância global para ser usada em todo o app
const db = new LocalDatabase();
