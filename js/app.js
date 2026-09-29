/**
 * app.js - Lógica Central do Studio Letícia (PWA)
 * Gestão de Agenda, Clientes, Anamnese, Caixa e Integração com WhatsApp
 */

class StudioApp {
  constructor() {
    this.currentTab = 'hoje';
    const now = new Date();
    this.calendarYear = now.getFullYear();
    this.calendarMonth = now.getMonth();
    this.selectedAgendaDate = now.toISOString().split('T')[0];
    this.agendaStatusFilter = 'todos';
    this.allClients = [];
    this.allServices = [];
    this.activeAppointmentForCompletion = null;
    this.isAuthenticated = false;
    this.standardSlots = [
      '08:00', '09:00', '10:00', '11:00', 
      '13:30', '14:30', '15:30', '16:30', '17:30'
    ];

    window.addEventListener('DOMContentLoaded', () => this.init());
  }

  async init() {
    await db.ready();
    this.setupAuthMasks();
    this.initPWAInstall();
    this.isAuthenticated = this.checkAuth();

    const urlParams = new URLSearchParams(window.location.search);
    const wantsAdmin = urlParams.get('login') === 'true' || urlParams.get('admin') === 'true';

    if (this.isAuthenticated) {
      this.showAppView();
      this.setupDateDisplay();
      this.setupEventListeners();
      await this.loadInitialData();
      await this.loadTodayTab();
      await this.startNotificationSystem();
    } else {
      this.showClientBookingView();
      if (wantsAdmin) {
        this.showLoginModal();
      }
    }
  }

  showAppView() {
    const bookingView = document.getElementById('client-booking-view');
    const appContainer = document.getElementById('app-container');
    const loginScreen = document.getElementById('login-screen');
    
    if (bookingView) bookingView.style.display = 'none';
    if (loginScreen) loginScreen.classList.add('hidden');
    if (appContainer) appContainer.style.display = 'block';
    this.updatePWAUI(this.isStandaloneApp);
  }

  showClientBookingView() {
    const bookingView = document.getElementById('client-booking-view');
    const appContainer = document.getElementById('app-container');
    const loginScreen = document.getElementById('login-screen');

    if (appContainer) appContainer.style.display = 'none';
    if (loginScreen) loginScreen.classList.add('hidden');
    if (bookingView) {
      bookingView.style.display = 'block';
      this.initClientBooking();
    }
    this.updatePWAUI(this.isStandaloneApp);
  }

  showLoginModal() {
    const screen = document.getElementById('login-screen');
    if (screen) {
      screen.classList.remove('hidden');
      setTimeout(() => {
        const cpfInput = document.getElementById('login-cpf');
        if (cpfInput) cpfInput.focus();
      }, 200);
    }
  }

  hideLoginModal() {
    const screen = document.getElementById('login-screen');
    if (screen) {
      screen.classList.add('hidden');
    }
  }

  // =========================================================================
  // AUTENTICAÇÃO E SEGURANÇA (LOGIN / LOGOUT / TROCA DE SENHA)
  // =========================================================================
  checkAuth() {
    const localAuth = localStorage.getItem('studio_leticia_auth');
    const sessionAuth = sessionStorage.getItem('studio_leticia_auth');
    return localAuth === 'true' || sessionAuth === 'true';
  }

  showLoginScreen() {
    const screen = document.getElementById('login-screen');
    if (screen) {
      screen.classList.remove('hidden');
      setTimeout(() => {
        const cpfInput = document.getElementById('login-cpf');
        if (cpfInput) cpfInput.focus();
      }, 250);
    }
  }

  hideLoginScreen() {
    const screen = document.getElementById('login-screen');
    if (screen) {
      screen.classList.add('hidden');
    }
  }

  setupAuthMasks() {
    const applyCpfMask = (input) => {
      if (!input) return;
      input.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g, '').slice(0, 11);
        if (v.length > 9) {
          v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
        } else if (v.length > 6) {
          v = v.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
        } else if (v.length > 3) {
          v = v.replace(/(\d{3})(\d{1,3})/, '$1.$2');
        }
        e.target.value = v;
      });
    };

    applyCpfMask(document.getElementById('login-cpf'));
    applyCpfMask(document.getElementById('setting-auth-cpf'));
    applyCpfMask(document.getElementById('new-user-cpf'));
  }

  togglePasswordVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    if (input.type === 'password') {
      input.type = 'text';
      if (btn) btn.textContent = '🙈';
    } else {
      input.type = 'password';
      if (btn) btn.textContent = '👁️';
    }
  }

  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async hashPassword(password) {
    if (!password) return '';
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(password.trim());
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      return password.trim();
    }
  }

  checkRateLimit() {
    const lockUntil = localStorage.getItem('auth_lock_until');
    if (lockUntil) {
      const remainingMs = Number(lockUntil) - Date.now();
      if (remainingMs > 0) {
        const remainingMin = Math.ceil(remainingMs / 60000);
        return `Acesso temporariamente bloqueado por excesso de tentativas incorretas. Tente novamente em ${remainingMin} minuto(s).`;
      } else {
        localStorage.removeItem('auth_lock_until');
        localStorage.removeItem('auth_failed_attempts');
      }
    }
    return null;
  }

  recordFailedAttempt() {
    let attempts = Number(localStorage.getItem('auth_failed_attempts') || '0') + 1;
    localStorage.setItem('auth_failed_attempts', String(attempts));
    if (attempts >= 5) {
      const lockDuration = 5 * 60 * 1000; // 5 minutos de bloqueio
      localStorage.setItem('auth_lock_until', String(Date.now() + lockDuration));
      return 'Você errou a senha 5 vezes seguidas. O acesso foi bloqueado por 5 minutos por segurança anti-invasão.';
    }
    const restantes = 5 - attempts;
    return `Senha ou CPF incorreto! Restam ${restantes} tentativa(s) antes do bloqueio temporário.`;
  }

  clearFailedAttempts() {
    localStorage.removeItem('auth_failed_attempts');
    localStorage.removeItem('auth_lock_until');
  }

  async getUsersList() {
    const config = (await db.get('config', 'app_config')) || {};
    if (!config.usuarios || !Array.isArray(config.usuarios) || config.usuarios.length === 0) {
      const defaultUser = {
        id: 'usr_main',
        nome: 'Letícia (Principal)',
        cpf: config.authCpf || '',
        senhaHash: config.authSenhaHash || null,
        senha: config.authSenha || 'LETICIA123',
        role: 'admin',
        criadoEm: new Date().toISOString()
      };
      config.usuarios = [defaultUser];
      await db.put('config', config);
    }
    return config.usuarios;
  }

  async renderUsersList() {
    const listEl = document.getElementById('setting-users-list');
    if (!listEl) return;

    const usuarios = await this.getUsersList();
    listEl.innerHTML = usuarios.map((u, idx) => {
      const isMain = idx === 0 || u.role === 'admin';
      return `
        <div style="background: var(--bg-card-tint); border: 1px solid var(--border-light); border-radius: var(--radius-md); padding: 12px 14px; display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="width: 38px; height: 38px; border-radius: 50%; background: var(--accent-gold-light); color: var(--accent-gold-dark); display: flex; align-items: center; justify-content: center; font-size: 1.1rem; font-weight: bold; flex-shrink: 0;">
              👤
            </div>
            <div>
              <div style="font-weight: 600; font-size: 0.95rem; color: var(--text-main); display: flex; align-items: center; gap: 6px;">
                ${this.escapeHtml(u.nome)}
                ${isMain ? '<span style="font-size: 0.65rem; background: var(--accent-bronze-light); color: var(--accent-bronze); padding: 2px 6px; border-radius: 6px; font-weight: bold;">ADMIN</span>' : ''}
              </div>
              <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 2px;">
                CPF: <strong>${this.escapeHtml(u.cpf || 'Não configurado')}</strong>
              </div>
            </div>
          </div>
          <div>
            ${usuarios.length > 1 ? `
              <button type="button" onclick="app.deleteUser('${u.id}')" style="background: var(--danger-light); color: var(--danger); border: 1px solid rgba(185,55,40,0.2); padding: 6px 12px; border-radius: var(--radius-sm); font-size: 0.75rem; cursor: pointer; font-weight: 600;">
                Excluir
              </button>
            ` : `
              <span style="font-size: 0.75rem; color: var(--text-light); font-weight: 500;">Principal</span>
            `}
          </div>
        </div>
      `;
    }).join('');
  }

  openNewUserModal() {
    const modal = document.getElementById('modal-new-user');
    if (modal) {
      const form = document.getElementById('form-new-user');
      if (form) form.reset();
      modal.classList.add('active');
      setTimeout(() => {
        const input = document.getElementById('new-user-nome');
        if (input) input.focus();
      }, 200);
    }
  }

  async handleRegisterUser(e) {
    e.preventDefault();
    const nomeInput = document.getElementById('new-user-nome');
    const cpfInput = document.getElementById('new-user-cpf');
    const pwInput = document.getElementById('new-user-pw');
    const confirmPwInput = document.getElementById('new-user-confirm-pw');

    const nome = (nomeInput.value || '').trim();
    const cpf = (cpfInput.value || '').trim();
    const cpfDigits = cpf.replace(/\D/g, '');
    const pw = (pwInput.value || '').trim();
    const confirmPw = (confirmPwInput.value || '').trim();

    if (!nome) {
      alert('Por favor, informe o nome do usuário.');
      nomeInput.focus();
      return;
    }

    if (cpfDigits.length !== 11) {
      alert('Por favor, informe um CPF completo com 11 dígitos.');
      cpfInput.focus();
      return;
    }

    const config = (await db.get('config', 'app_config')) || {};
    const usuarios = await this.getUsersList();

    const cpfDuplicado = usuarios.some(u => (u.cpf || '').replace(/\D/g, '') === cpfDigits);
    if (cpfDuplicado) {
      alert('Este CPF já está cadastrado para outro usuário!');
      cpfInput.focus();
      return;
    }

    if (pw.length < 6) {
      alert('Por segurança, a nova senha deve ter no mínimo 6 caracteres.');
      pwInput.focus();
      return;
    }

    if (pw !== confirmPw) {
      alert('A confirmação da senha não coincide com a senha digitada.');
      confirmPwInput.focus();
      return;
    }

    const senhaHash = await this.hashPassword(pw);
    const novoUsuario = {
      id: 'usr_' + Date.now(),
      nome,
      cpf,
      senhaHash,
      role: 'user',
      criadoEm: new Date().toISOString()
    };

    usuarios.push(novoUsuario);
    config.usuarios = usuarios;
    await db.put('config', config);

    this.closeModal('modal-new-user');
    await this.renderUsersList();
    this.showToast(`Usuário "${nome}" cadastrado com sucesso! ✨`);
  }

  async deleteUser(userId) {
    const config = (await db.get('config', 'app_config')) || {};
    const usuarios = await this.getUsersList();

    const user = usuarios.find(u => u.id === userId);
    if (!user) return;

    if (!confirm(`Deseja realmente remover o acesso de "${user.nome}"?`)) return;

    if (usuarios.length <= 1) {
      alert('Não é possível excluir o único usuário do aplicativo.');
      return;
    }

    config.usuarios = usuarios.filter(u => u.id !== userId);
    await db.put('config', config);

    await this.renderUsersList();
    this.showToast(`Usuário "${user.nome}" removido com sucesso.`);
  }

  async handleLogin(e) {
    e.preventDefault();
    const cpfInput = document.getElementById('login-cpf');
    const pwInput = document.getElementById('login-password');
    const rememberCheckbox = document.getElementById('login-remember');
    const errBox = document.getElementById('login-error');

    if (errBox) errBox.style.display = 'none';

    // Verificação de taxa de tentativas (Anti-Brute Force)
    const lockMsg = this.checkRateLimit();
    if (lockMsg) {
      this.showLoginError(lockMsg);
      return;
    }

    const enteredCpfDigits = (cpfInput.value || '').replace(/\D/g, '');
    const enteredPassword = (pwInput.value || '').trim();

    if (!enteredCpfDigits || enteredCpfDigits.length < 11) {
      this.showLoginError('Por favor, informe um CPF válido com 11 dígitos.');
      if (cpfInput) cpfInput.focus();
      return;
    }

    if (!enteredPassword) {
      this.showLoginError('Por favor, digite sua senha.');
      if (pwInput) pwInput.focus();
      return;
    }

    const config = (await db.get('config', 'app_config')) || {};
    const usuarios = await this.getUsersList();
    const enteredHash = await this.hashPassword(enteredPassword);

    // Procura na lista de usuários cadastrados
    let matchedUser = usuarios.find(u => (u.cpf || '').replace(/\D/g, '') === enteredCpfDigits);

    // Fallback: se não encontrou em usuarios, verifica config direto (migração suave)
    if (!matchedUser && config.authCpf) {
      const configCpfDigits = (config.authCpf || '').replace(/\D/g, '');
      if (configCpfDigits === enteredCpfDigits) {
        matchedUser = {
          id: 'usr_main',
          nome: 'Letícia (Principal)',
          cpf: config.authCpf,
          senhaHash: config.authSenhaHash || null,
          senha: config.authSenha || 'LETICIA123',
          role: 'admin'
        };
      }
    }

    // Se ainda não houver nenhum usuário com CPF cadastrado (primeiríssimo acesso)
    if (!matchedUser && usuarios.length === 1 && !usuarios[0].cpf) {
      usuarios[0].cpf = cpfInput.value.trim();
      usuarios[0].senhaHash = enteredHash;
      delete usuarios[0].senha;
      config.authCpf = cpfInput.value.trim();
      config.authSenhaHash = enteredHash;
      delete config.authSenha;
      config.usuarios = usuarios;
      await db.put('config', config);
      matchedUser = usuarios[0];
    }

    if (!matchedUser) {
      const msg = this.recordFailedAttempt();
      this.showLoginError('CPF não confere com nenhum usuário cadastrado. ' + msg);
      if (cpfInput) cpfInput.select();
      return;
    }

    // Valida senha do usuário encontrado
    let isPasswordValid = false;
    if (matchedUser.senhaHash) {
      isPasswordValid = (enteredHash === matchedUser.senhaHash);
    } else if (matchedUser.senha) {
      isPasswordValid = (enteredPassword === matchedUser.senha || 
        enteredPassword.toUpperCase() === matchedUser.senha.toUpperCase());
      if (isPasswordValid) {
        matchedUser.senhaHash = enteredHash;
        delete matchedUser.senha;
        config.usuarios = usuarios;
        config.authSenhaHash = enteredHash;
        delete config.authSenha;
        await db.put('config', config);
      }
    }

    if (!isPasswordValid) {
      const msg = this.recordFailedAttempt();
      this.showLoginError(msg);
      if (pwInput) pwInput.select();
      return;
    }

    // Sucesso: zera tentativas falhas
    this.clearFailedAttempts();

    // Salva sessão
    if (rememberCheckbox && rememberCheckbox.checked) {
      localStorage.setItem('studio_leticia_auth', 'true');
      localStorage.setItem('studio_leticia_user_name', matchedUser.nome || 'Letícia');
    }
    sessionStorage.setItem('studio_leticia_auth', 'true');
    sessionStorage.setItem('studio_leticia_user_name', matchedUser.nome || 'Letícia');
    this.isAuthenticated = true;

    this.hideLoginModal();
    this.showAppView();
    this.showToast(`Bem-vinda(o), ${matchedUser.nome}! ✨ Acesso liberado.`);

    // Inicializa a aplicação se ainda não carregou
    if (!this.allClients || this.allClients.length === 0) {
      this.setupDateDisplay();
      this.setupEventListeners();
      await this.loadInitialData();
      await this.loadTodayTab();
    }
    await this.startNotificationSystem();
  }

  showLoginError(msg) {
    const errBox = document.getElementById('login-error');
    if (errBox) {
      errBox.textContent = msg;
      errBox.style.display = 'block';
    } else {
      alert(msg);
    }
  }

  async logout() {
    if (confirm('Deseja realmente sair e bloquear o aplicativo?')) {
      localStorage.removeItem('studio_leticia_auth');
      sessionStorage.removeItem('studio_leticia_auth');
      this.isAuthenticated = false;

      // Limpa os campos de senha
      const pwInput = document.getElementById('login-password');
      if (pwInput) pwInput.value = '';
      const errBox = document.getElementById('login-error');
      if (errBox) errBox.style.display = 'none';

      this.showClientBookingView();
      this.showToast('Aplicativo bloqueado com segurança. Até breve!');
    }
  }

  async handleChangeAuth(e) {
    e.preventDefault();
    const newCpfInput = document.getElementById('setting-auth-cpf');
    const currentPwInput = document.getElementById('setting-auth-current-pw');
    const newPwInput = document.getElementById('setting-auth-new-pw');
    const confirmPwInput = document.getElementById('setting-auth-confirm-pw');

    const newCpf = (newCpfInput.value || '').trim();
    const newCpfDigits = newCpf.replace(/\D/g, '');
    const currentPw = (currentPwInput.value || '').trim();
    const newPw = (newPwInput.value || '').trim();
    const confirmPw = (confirmPwInput.value || '').trim();

    if (newCpfDigits.length < 11) {
      alert('Por favor, informe um CPF completo com 11 dígitos.');
      newCpfInput.focus();
      return;
    }

    const config = (await db.get('config', 'app_config')) || {};
    const usuarios = await this.getUsersList();
    const configuredPw = config.authSenha || 'LETICIA123';
    const configuredPwHash = config.authSenhaHash || null;

    // Valida senha atual via hash ou legado
    const currentHash = await this.hashPassword(currentPw);
    let isCurrentPwValid = false;
    if (configuredPwHash) {
      isCurrentPwValid = (currentHash === configuredPwHash);
    } else {
      isCurrentPwValid = (currentPw === configuredPw || currentPw.toUpperCase() === configuredPw.toUpperCase());
    }

    // Se não validou pelo config mestre, tenta pelos usuários
    if (!isCurrentPwValid && usuarios && usuarios.length > 0) {
      isCurrentPwValid = usuarios.some(u => u.senhaHash === currentHash || u.senha === currentPw);
    }

    if (!isCurrentPwValid) {
      alert('A Senha Atual digitada está incorreta! Verifique e tente novamente.');
      currentPwInput.focus();
      return;
    }

    if (newPw.length < 6) {
      alert('Por segurança anti-hacker, a nova senha deve ter no mínimo 6 caracteres.');
      newPwInput.focus();
      return;
    }

    if (newPw !== confirmPw) {
      alert('A Confirmação da Nova Senha não coincide com a Nova Senha digitada.');
      confirmPwInput.focus();
      return;
    }

    const newHash = await this.hashPassword(newPw);

    // Grava novos dados com Criptografia SHA-256
    config.authCpf = newCpf;
    config.authSenhaHash = newHash;
    delete config.authSenha;

    // Atualiza também na lista de usuários
    if (usuarios && usuarios.length > 0) {
      const targetUser = usuarios.find(u => (u.cpf || '').replace(/\D/g, '') === newCpfDigits) || usuarios[0];
      if (targetUser) {
        targetUser.cpf = newCpf;
        targetUser.senhaHash = newHash;
        delete targetUser.senha;
      }
      config.usuarios = usuarios;
    }

    await db.put('config', config);

    // Atualiza campo do login também
    const loginCpf = document.getElementById('login-cpf');
    if (loginCpf) loginCpf.value = newCpf;

    currentPwInput.value = '';
    newPwInput.value = '';
    confirmPwInput.value = '';

    await this.renderUsersList();
    this.showToast('Login e Senha atualizados com segurança! 🔒✨');
  }

  // =========================================================================
  // NAVEGAÇÃO E ABAS
  // =========================================================================
  switchTab(tabId, btnElement) {
    // Normaliza nome da aba (inicio mapeia para hoje)
    if (tabId === 'inicio') tabId = 'hoje';
    this.currentTab = tabId;

    // Se o btnElement não foi passado diretamente, busca pelo ID correspondente
    if (!btnElement) {
      btnElement = document.getElementById(`nav-btn-${tabId}`);
    }

    // Atualiza botões da barra inferior
    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
    if (btnElement) {
      btnElement.classList.add('active');
    }

    // Atualiza painéis
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
    const targetPanel = document.getElementById(`tab-${tabId}`);
    if (targetPanel) {
      targetPanel.classList.add('active');
    }

    // Carrega dados específicos da aba selecionada
    if (tabId === 'hoje') this.loadTodayTab();
    if (tabId === 'agenda') this.loadAgendaTab();
    if (tabId === 'clientes') this.loadClientsTab();
    if (tabId === 'caixa') this.loadCashFlowTab();
    if (tabId === 'ajustes') this.loadSettingsTab();
  }

  setupDateDisplay() {
    const hoje = new Date();
    const opcoes = { weekday: 'long', day: 'numeric', month: 'long' };
    const dataFormatada = hoje.toLocaleDateString('pt-BR', opcoes);
    
    // Deixa a primeira letra maiúscula
    const formatadaCapitalizada = dataFormatada.charAt(0).toUpperCase() + dataFormatada.slice(1);
    
    const displayEl = document.getElementById('today-date-display');
    if (displayEl) displayEl.textContent = formatadaCapitalizada;

    const agendaInput = document.getElementById('agenda-date-filter');
    if (agendaInput) {
      agendaInput.value = this.selectedAgendaDate;
    }

    const appDateInput = document.getElementById('app-date');
    if (appDateInput) {
      appDateInput.value = this.selectedAgendaDate;
    }

    const expDateInput = document.getElementById('expense-date');
    if (expDateInput) {
      expDateInput.value = this.selectedAgendaDate;
    }
  }

  setupEventListeners() {
    // Fecha modal ao clicar fora da folha
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.classList.remove('active');
        }
      });
    });

    // Filtro de data na aba Agenda
    const agendaDateInput = document.getElementById('agenda-date-filter');
    if (agendaDateInput) {
      agendaDateInput.addEventListener('change', (e) => {
        this.selectedAgendaDate = e.target.value;
        this.loadAgendaTab();
      });
    }
  }

  async loadInitialData() {
    this.allClients = await db.getAll('clientes');
    
    // Sincroniza catálogo de procedimentos da nuvem se disponível (evita sobrescrever com dados locais antigos)
    await this.syncServicesFromCloudIfAvailable();

    this.allServices = await db.getAll('servicos');
    this.populateClientSelects();
    this.populateServiceSelects();
    this.syncAppointmentsToCloud();
    await this.loadPublicScheduleConfig();
  }

  async syncServicesFromCloudIfAvailable() {
    const cloud = window.StudioCloud || (typeof StudioCloud !== 'undefined' ? StudioCloud : null);
    if (!cloud || !cloud.isConfigured()) return;
    try {
      const remoteServices = await cloud.getPublicServices();
      if (Array.isArray(remoteServices) && remoteServices.length > 0) {
        const localServices = await db.getAll('servicos');
        
        for (const remote of remoteServices) {
          await db.put('servicos', {
            id: remote.id,
            nome: remote.nome,
            categoria: remote.categoria || 'Corporal',
            duracaoMin: remote.duracaoMin || 60,
            preco: Number(remote.preco) || 0,
            descricao: remote.descricao || '',
            visivelNoSite: remote.visivelNoSite !== false,
            isPacote: false
          });
        }

        const remoteIds = new Set(remoteServices.map(s => s.id));
        for (const loc of localServices) {
          if (!loc.isPacote && !remoteIds.has(loc.id)) {
            await db.delete('servicos', loc.id);
          }
        }
      }
    } catch (e) {
      console.warn('Não foi possível sincronizar serviços da nuvem no início:', e);
    }
  }

  // =========================================================================
  // ABA 1: HOJE (Atendimentos do dia)
  // =========================================================================
  async loadTodayTab() {
    const hojeStr = new Date().toISOString().split('T')[0];
    const agendamentos = await db.getAll('agendamentos');
    const hojeApps = agendamentos.filter(a => a.data === hojeStr);

    // Ordena por horário
    hojeApps.sort((a, b) => a.horario.localeCompare(b.horario));

    const totalHoje = hojeApps.length;
    let recebidoHoje = 0;
    let concluidosHoje = 0;

    hojeApps.forEach(a => {
      if (a.status === 'concluido') {
        concluidosHoje++;
        if (a.pago && a.formaPagamento !== 'pacote') {
          recebidoHoje += (parseFloat(a.valor) || 0);
        }
      }
    });

    // Atualiza indicadores
    document.getElementById('today-count').textContent = totalHoje;
    document.getElementById('today-revenue').textContent = this.formatCurrency(recebidoHoje);
    
    const pendentesCount = totalHoje - concluidosHoje;
    document.getElementById('today-pending-count').textContent = 
      totalHoje > 0 ? `${concluidosHoje} de ${totalHoje} atendidos` : 'Nenhum agendamento';

    // Renderiza lista
    const listContainer = document.getElementById('today-appointments-list');
    if (!listContainer) return;

    if (hojeApps.length === 0) {
      listContainer.innerHTML = `
        <div class="card" style="text-align: center; padding: 30px 20px; color: var(--text-muted);">
          <div style="font-size: 2.2rem; margin-bottom: 8px;">🌸</div>
          <div style="font-weight: 700; color: var(--text-main); margin-bottom: 4px;">Nenhum atendimento para hoje</div>
          <div style="font-size: 0.85rem;">Aproveite o tempo livre ou agende novas clientes clicando no botão acima!</div>
        </div>
      `;
      return;
    }

    listContainer.innerHTML = hojeApps.map(app => this.renderAppointmentCard(app)).join('');
  }

  // =========================================================================
  // ABA 2: AGENDA (Calendário Visual Interativo)
  // =========================================================================
  async loadAgendaTab() {
    await this.renderCalendar();
    await this.updateSelectedDayPanel();
  }

  async renderCalendar() {
    const monthNames = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];

    const titleEl = document.getElementById('cal-month-name');
    if (titleEl) {
      titleEl.textContent = `${monthNames[this.calendarMonth]} de ${this.calendarYear}`;
    }

    const gridEl = document.getElementById('calendar-days-grid');
    if (!gridEl) return;

    // Busca todos os agendamentos para sinalizar dias com atendimentos
    const todosAgendamentos = await db.getAll('agendamentos');
    const diasComAtendimento = new Set(
      todosAgendamentos.filter(a => a.status !== 'cancelado').map(a => a.data)
    );

    const hojeStr = new Date().toISOString().split('T')[0];
    const primeiroDiaSemana = new Date(this.calendarYear, this.calendarMonth, 1).getDay(); // 0=Dom ... 6=Sab
    const totalDiasMes = new Date(this.calendarYear, this.calendarMonth + 1, 0).getDate();

    let html = '';

    // Células vazias que precedem o dia 1
    for (let i = 0; i < primeiroDiaSemana; i++) {
      html += `<div class="cal-cell empty"></div>`;
    }

    // Dias do mês
    for (let dia = 1; dia <= totalDiasMes; dia++) {
      const mesStr = String(this.calendarMonth + 1).padStart(2, '0');
      const diaStr = String(dia).padStart(2, '0');
      const dateStr = `${this.calendarYear}-${mesStr}-${diaStr}`;

      const isToday = dateStr === hojeStr;
      const isSelected = dateStr === this.selectedAgendaDate;
      const hasEvents = diasComAtendimento.has(dateStr);

      let classes = 'cal-cell';
      if (isToday) classes += ' today';
      if (isSelected) classes += ' selected';

      html += `
        <div class="${classes}" onclick="app.selectCalendarDate('${dateStr}')">
          <span>${dia}</span>
          ${hasEvents ? '<span class="cal-cell-dot"></span>' : ''}
        </div>
      `;
    }

    gridEl.innerHTML = html;
  }

  changeCalendarMonth(delta) {
    this.calendarMonth += delta;
    if (this.calendarMonth < 0) {
      this.calendarMonth = 11;
      this.calendarYear--;
    } else if (this.calendarMonth > 11) {
      this.calendarMonth = 0;
      this.calendarYear++;
    }
    this.renderCalendar();
  }

  async goToCalendarToday() {
    const now = new Date();
    this.calendarYear = now.getFullYear();
    this.calendarMonth = now.getMonth();
    const todayStr = now.toISOString().split('T')[0];
    await this.selectCalendarDate(todayStr);
  }

  async selectCalendarDate(dateStr) {
    this.selectedAgendaDate = dateStr;
    await this.renderCalendar();
    await this.updateSelectedDayPanel();
    const panel = document.getElementById('calendar-selected-day-panel');
    if (panel) {
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  async updateSelectedDayPanel() {
    // Formata o título da data selecionada em português
    const [y, m, d] = this.selectedAgendaDate.split('-').map(Number);
    const dataObj = new Date(y, m - 1, d, 12, 0, 0);
    const opcoes = { weekday: 'long', day: 'numeric', month: 'long' };
    const formatada = dataObj.toLocaleDateString('pt-BR', opcoes);
    const capitalizada = formatada.charAt(0).toUpperCase() + formatada.slice(1);

    const titleEl = document.getElementById('selected-day-title');
    if (titleEl) titleEl.textContent = `📅 ${capitalizada}`;

    const agendamentos = await db.getAll('agendamentos');
    let doDia = agendamentos.filter(a => a.data === this.selectedAgendaDate);

    const subEl = document.getElementById('selected-day-subtitle');
    if (subEl) {
      const ativos = doDia.filter(a => a.status !== 'cancelado').length;
      subEl.textContent = ativos === 0 ? 'Nenhum atendimento marcado' : 
                          ativos === 1 ? '1 atendimento marcado' : `${ativos} atendimentos marcados`;
    }

    if (this.agendaStatusFilter !== 'todos') {
      doDia = doDia.filter(a => a.status === this.agendaStatusFilter);
    }

    doDia.sort((a, b) => a.horario.localeCompare(b.horario));

    const listContainer = document.getElementById('agenda-appointments-list');
    if (!listContainer) return;

    if (doDia.length === 0) {
      listContainer.innerHTML = `
        <div class="card" style="text-align: center; padding: 25px 20px; color: var(--text-muted); margin-top: 6px;">
          <div style="font-size: 2rem; margin-bottom: 6px;">🌸</div>
          <div style="font-weight: 700; color: var(--text-main); margin-bottom: 4px;">Nenhum horário marcado nesta data</div>
          <div style="font-size: 0.8rem; margin-bottom: 12px;">Data livre para receber novas clientes.</div>
          <button class="btn-complete" style="font-size: 0.8rem; padding: 6px 14px;" onclick="app.openNewAppointmentModal('${this.selectedAgendaDate}')">
            + Agendar Horário Neste Dia
          </button>
        </div>
      `;
      return;
    }

    listContainer.innerHTML = doDia.map(app => this.renderAppointmentCard(app)).join('');
  }

  filterAgendaStatus(status) {
    this.agendaStatusFilter = status;
    document.querySelectorAll('.agenda-filter-btn').forEach(btn => {
      if (btn.dataset.status === status) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
    this.updateSelectedDayPanel();
  }

  // Conversor de HH:MM para minutos totais desde 00:00
  timeStringToMinutes(timeStr) {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  // Validador de Conflito de Horários na mesma Data
  async checkTimeConflict(data, horario, duracaoMin, ignoreId = null) {
    const todos = await db.getAll('agendamentos');
    const doMesmoDia = todos.filter(a => 
      a.data === data && 
      a.status !== 'cancelado' && 
      a.id !== ignoreId
    );

    const novoInicio = this.timeStringToMinutes(horario);
    const novoFim = novoInicio + (parseInt(duracaoMin, 10) || 60);

    for (const a of doMesmoDia) {
      const agdInicio = this.timeStringToMinutes(a.horario);
      const agdFim = agdInicio + (parseInt(a.duracaoMin, 10) || 60);

      // Sobreposição de horários: novoInicio < agdFim && agdInicio < novoFim
      if (novoInicio < agdFim && agdInicio < novoFim) {
        const fimHoras = Math.floor(agdFim / 60).toString().padStart(2, '0');
        const fimMins = (agdFim % 60).toString().padStart(2, '0');
        return {
          hasConflict: true,
          conflito: a,
          intervalo: `${a.horario} às ${fimHoras}:${fimMins}`
        };
      }
    }

    return { hasConflict: false };
  }

  // Renderizador unificado de Card de Agendamento
  renderAppointmentCard(app) {
    const isConcluido = app.status === 'concluido';
    const statusClass = `status-${app.status || 'agendado'}`;
    const statusLabel = app.status === 'concluido' ? 'Concluído' : 
                        app.status === 'cancelado' ? 'Cancelado' : 'Agendado';

    const wppLink = this.generateWhatsAppReminderUrl(app);
    const pacoteTag = app.numSessao ? `<span class="app-package-tag" style="background: #FFF3E0; color: #B26A00; border: 1px solid #FFE0B2; padding: 2px 7px; border-radius: 5px; font-size: 0.72rem; font-weight: 800; display: inline-flex; align-items: center; gap: 3px;">✨ Sessão ${app.numSessao}${app.totalSessoesPacote ? ` de ${app.totalSessoesPacote}` : ''}${app.pacoteNome ? ` (${this.escapeHtml(app.pacoteNome)})` : ''}</span>` : '';

    return `
      <div class="appointment-card ${app.status || 'agendado'}">
        <div class="app-card-header">
          <span class="app-time-badge">⏰ ${app.horario} (${app.duracaoMin || 60} min)</span>
          <span class="app-status-badge ${statusClass}">${statusLabel}</span>
        </div>

        <div class="app-client-name" onclick="app.viewClientDetails('${this.escapeHtml(app.clienteId)}')" style="cursor: pointer;">
          ${this.escapeHtml(app.clienteNome)} ${pacoteTag}
        </div>
        <div class="app-service-name">${this.escapeHtml(app.servicoNome)}</div>

        ${app.notas ? `<div style="font-size: 0.78rem; color: var(--text-muted); margin-bottom: 6px;">📝 ${this.escapeHtml(app.notas)}</div>` : ''}

        <div class="app-details-row">
          <span>Valor: <strong class="app-price">${this.formatCurrency(app.valor)}</strong></span>
          <span>${app.pago ? '✅ ' + (app.formaPagamento === 'pacote' ? 'Pago no Plano' : 'Pago (' + (app.formaPagamento || 'PIX').toUpperCase() + ')') : '⏳ Aguardando Pagamento'}</span>
        </div>

        <div class="app-actions">
          <a href="${wppLink}" target="_blank" class="btn-wpp" title="Enviar Lembrete">
            <span>💬 Lembrar WhatsApp</span>
          </a>

          ${!isConcluido ? `
            <button class="btn-complete" onclick="app.openCompleteModal('${app.id}')">
              <span>✓ Concluir</span>
            </button>
          ` : `
            <button class="icon-btn" style="width: auto; padding: 0 10px; font-size: 0.75rem;" onclick="app.reopenAppointment('${app.id}')">
              Reabrir
            </button>
          `}

          <button class="icon-btn" style="width: 34px; height: 34px;" onclick="app.deleteAppointment('${app.id}')" title="Excluir">
            🗑️
          </button>
        </div>
      </div>
    `;
  }

  // Gera o link do WhatsApp com mensagem pronta em 1 toque
  generateWhatsAppReminderUrl(app) {
    const rawPhone = (app.whatsapp || '').replace(/\D/g, '');
    const cleanPhone = rawPhone.length === 11 ? '55' + rawPhone : (rawPhone.startsWith('55') ? rawPhone : '55' + rawPhone);

    const [ano, mes, dia] = app.data.split('-');
    const dataFormatada = `${dia}/${mes}`;

    const sessaoInfo = app.numSessao ? ` (Sessão ${app.numSessao}${app.totalSessoesPacote ? ` de ${app.totalSessoesPacote}` : ''})` : '';
    const msg = `Olá, ${app.clienteNome}! ✨\nPassando para confirmar seu horário de *${app.servicoNome}*${sessaoInfo} com a Letícia no dia *${dataFormatada}* às *${app.horario}*.\n\nPodemos confirmar? Te espero com muito carinho! 💆‍♀️🌸`;

    return `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(msg)}`;
  }

  // =========================================================================
  // ABA 3: CLIENTES & ANAMNESE
  // =========================================================================
  async loadClientsTab() {
    this.allClients = await db.getAll('clientes');
    this.allClients.sort((a, b) => a.nome.localeCompare(b.nome));

    document.getElementById('clients-count').textContent = `${this.allClients.length} clientes cadastradas`;
    this.filterClients();
  }

  filterClients() {
    const query = (document.getElementById('client-search').value || '').toLowerCase().trim();
    const queryClean = query.replace(/\D/g, '');
    const filtered = this.allClients.filter(c => 
      c.nome.toLowerCase().includes(query) || 
      (c.whatsapp && c.whatsapp.includes(query)) ||
      (c.cpf && (c.cpf.includes(query) || (queryClean && c.cpf.includes(queryClean))))
    );

    const container = document.getElementById('clients-list');
    if (!container) return;

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="card" style="text-align: center; color: var(--text-muted); padding: 20px;">
          Nenhuma cliente encontrada com "${query}".
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(c => {
      const iniciais = c.nome.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
      const temAlerta = c.anamnese && (c.anamnese.cirurgiaRecente || c.anamnese.restricoes || c.anamnese.alergias);
      const temPacote = c.pacotes && c.pacotes.some(p => p.status === 'ativo');

      return `
        <div class="client-card" onclick="app.viewClientDetails('${c.id}')">
          <div style="display: flex; align-items: center; flex: 1;">
            <div class="client-avatar">${iniciais}</div>
            <div class="client-info">
              <div class="client-name">${c.nome}</div>
              <div class="client-phone">📱 ${this.formatPhone(c.whatsapp)} ${c.cpf ? `• 🪪 ${this.formatCPF(c.cpf)}` : ''}</div>
              ${temAlerta ? `<span class="anamnese-badge">⚠️ Anamnese com Alertas</span>` : ''}
              ${temPacote ? `<span class="app-package-tag">Pacote Ativo</span>` : ''}
            </div>
          </div>
          <div style="font-size: 1.2rem; color: var(--text-light);">›</div>
        </div>
      `;
    }).join('');
  }

  async viewClientDetails(clientId) {
    const client = await db.get('clientes', clientId);
    if (!client) return;

    document.getElementById('details-client-name').textContent = client.nome;
    const rawPhone = (client.whatsapp || '').replace(/\D/g, '');
    const cleanPhone = rawPhone.length === 11 ? '55' + rawPhone : rawPhone;

    const body = document.getElementById('client-details-body');
    const an = client.anamnese || {};

    // Busca atendimentos concluídos da cliente para montar o histórico
    const todosAgendamentos = await db.getAll('agendamentos');
    const historicoCliente = todosAgendamentos
      .filter(a => a.clienteId === clientId && a.status === 'concluido')
      .sort((a, b) => (b.data + b.horario).localeCompare(a.data + a.horario));

    body.innerHTML = `
      <div style="margin-bottom: 14px; background: var(--bg-card-tint); border-radius: var(--radius-md); padding: 12px 14px; border: 1px solid var(--border-light);">
        <div style="margin-bottom: 8px;">
          ${historicoCliente.length > 0 ? `
            <span style="background: linear-gradient(135deg, #FAF2EA, #FFF8F0); border: 1px solid var(--accent-gold); color: var(--accent-gold-dark); font-size: 0.74rem; font-weight: bold; padding: 4px 10px; border-radius: 6px; display: inline-block;">
              🌟 Cliente Fidelidade • ${historicoCliente.length} atendimento(s) concluído(s)
            </span>
          ` : `
            <span style="background: #EBF8EE; border: 1px solid #C6EED0; color: #1E7E34; font-size: 0.74rem; font-weight: bold; padding: 4px 10px; border-radius: 6px; display: inline-block;">
              🆕 Primeiro Ciclo / Cadastro Recente
            </span>
          `}
        </div>

        <div style="font-size: 0.95rem; margin-bottom: 4px;">
          <strong>WhatsApp:</strong> 
          <a href="https://api.whatsapp.com/send?phone=${cleanPhone}" target="_blank" style="color: var(--green-wpp-dark); text-decoration: none; font-weight: bold;">
            📱 ${this.formatPhone(client.whatsapp)} (Abrir WhatsApp)
          </a>
        </div>

        <div style="font-size: 0.9rem; margin-bottom: 6px; color: var(--text-main);">
          <strong>🪪 CPF:</strong> <span>${client.cpf ? this.formatCPF(client.cpf) : '<em style="color: var(--text-muted);">Não informado</em>'}</span>
        </div>

        <div style="display: flex; flex-wrap: wrap; gap: 8px 14px; font-size: 0.85rem; color: var(--text-main); margin-top: 6px;">
          ${(client.peso || an.peso) ? `<span>⚖️ <strong>Peso:</strong> ${client.peso || an.peso} kg</span>` : ''}
          ${client.preferenciaSessao ? `<span>🎵 <strong>Sessão:</strong> ${client.preferenciaSessao}</span>` : ''}
          ${client.nascimento ? `<span>🎂 <strong>Nascimento:</strong> ${this.formatDate(client.nascimento)}</span>` : ''}
        </div>
        ${client.notas ? `
          <div style="font-size: 0.85rem; margin-top: 10px; background: var(--bg-card-soft); padding: 10px; border-radius: 8px; border: 1px dashed var(--border-color); word-break: break-word; white-space: pre-wrap; line-height: 1.4;">
            📝 <strong>Observações Gerais / Preferências:</strong><br>${client.notas}
          </div>
        ` : ''}
      </div>

      <!-- Ficha de Anamnese -->
      <div class="card" style="background: var(--bg-card-soft); border-left: 4px solid var(--primary); margin-bottom: 16px;">
        <div style="font-weight: 700; color: var(--primary); font-size: 0.95rem; margin-bottom: 10px;">
          📋 Ficha de Anamnese &amp; Saúde
        </div>
        <div style="font-size: 0.86rem; display: flex; flex-direction: column; gap: 10px; word-break: break-word; white-space: pre-wrap; line-height: 1.45;">
          <div><strong style="color: var(--text-main);">Queixa Principal / Objetivo:</strong><br><span style="color: #4A3E39;">${an.queixaPrincipal || 'Não informado'}</span></div>
          <div><strong style="color: var(--text-main);">Cirurgia Recente / Pós-Operatório:</strong><br><span style="color: #4A3E39;">${an.cirurgiaRecente || 'Nenhuma recente'}</span></div>
          <div><strong style="color: var(--text-main);">Alergias a Cosméticos/Óleos:</strong><br><span style="color: #4A3E39;">${an.alergias || 'Nenhuma informada'}</span></div>
          <div><strong style="color: var(--text-main);">Contraindicações / Alertas de Saúde:</strong><br><span style="color: #4A3E39;">${an.restricoes || 'Nenhuma contraindicação médica relatada'}</span></div>
        </div>
      </div>

      <!-- Pacotes de Sessões -->
      <div class="card" style="margin-bottom: 16px;">
        <div class="card-title-row">
          <div style="font-weight: 700; font-size: 0.95rem;">📦 Planos &amp; Pacotes de Sessões</div>
          <button class="btn-complete" style="font-size: 0.75rem; padding: 5px 10px;" onclick="app.openAddClientPackageModal('${client.id}')">✨ Ativar / Montar Plano</button>
        </div>
        <div id="client-packages-list">
          ${(client.pacotes && client.pacotes.length > 0) ? client.pacotes.map(p => {
            const isLivre = p.isPlanoLivre || p.tipo === 'plano_livre';
            const pctFeito = Math.round(((p.sessoesFeitas || 0) / (p.totalSessoes || 1)) * 100);
            return `
              <div style="background: ${isLivre ? 'linear-gradient(135deg, #FFFDFB, #FAF4ED)' : '#FDF9F5'}; border: 1.5px solid ${isLivre ? 'var(--accent-gold)' : 'var(--border-light)'}; border-radius: 10px; padding: 12px; margin-bottom: 8px; box-shadow: var(--shadow-sm);">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px;">
                  <div>
                    <div style="font-weight: 800; font-size: 0.92rem; color: var(--text-main);">${this.escapeHtml(p.servicoNome)}</div>
                    ${isLivre ? `<span style="font-size: 0.68rem; font-weight: 800; color: #8F4B3C; background: #FFE0B2; padding: 1px 6px; border-radius: 4px; display: inline-block; margin-top: 2px;">✨ PLANO LIVRE PERSONALIZADO</span>` : ''}
                  </div>
                  <span class="app-status-badge ${p.sessoesFeitas >= p.totalSessoes ? 'status-concluido' : 'status-agendado'}">
                    ${p.sessoesFeitas >= p.totalSessoes ? 'Finalizado' : 'Em Andamento'}
                  </span>
                </div>

                <!-- Detalhamento interativo por procedimento -->
                ${(() => {
                  let itemsToRender = [];
                  if (Array.isArray(p.itens) && p.itens.length > 0) {
                    itemsToRender = p.itens;
                  } else if (Array.isArray(p.servicosNomes) && p.servicosNomes.length > 0) {
                    itemsToRender = p.servicosNomes.map(nome => ({
                      nome,
                      sessoes: Math.max(1, Math.floor((p.totalSessoes || 1) / p.servicosNomes.length)),
                      feitas: 0
                    }));
                  } else {
                    itemsToRender = [{
                      nome: p.servicoNome,
                      sessoes: p.totalSessoes || 1,
                      feitas: p.sessoesFeitas || 0
                    }];
                  }

                  return `
                    <div style="margin: 8px 0; display: flex; flex-direction: column; gap: 6px;">
                      ${itemsToRender.map(i => {
                        const disponiveis = Math.max(0, i.sessoes - (i.feitas || 0));
                        const esgotado = disponiveis <= 0;
                        return `
                          <div style="background: #FFFFFF; border: 1.5px solid ${esgotado ? '#E2E8F0' : 'rgba(190, 122, 71, 0.28)'}; border-radius: 8px; padding: 8px 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                              <span style="font-weight: 700; font-size: 0.82rem; color: var(--text-main);">
                                💆‍♀️ ${this.escapeHtml(i.nome)}
                              </span>
                              <span style="font-size: 0.70rem; font-weight: 700; padding: 2px 7px; border-radius: 5px; ${esgotado ? 'background: #EDF2F7; color: #718096;' : 'background: #EBF8EE; color: #1E7E34;'}">
                                ${esgotado ? '✓ Esgotado' : `${disponiveis} disp.`}
                              </span>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.76rem;">
                              <span style="color: var(--text-muted);">
                                Feitas: <strong style="color: var(--primary);">${i.feitas || 0} de ${i.sessoes}</strong>
                              </span>
                              <div style="display: flex; gap: 4px;">
                                ${!esgotado ? `
                                  <button type="button" class="btn-sm" style="font-size: 0.70rem; padding: 3px 8px; background: var(--primary); color: #fff; border: none; border-radius: 4px; cursor: pointer; font-weight: 700;" onclick="app.openNewAppointmentForClientPackage('${client.id}', '${p.id}', '${this.escapeHtml(i.nome)}')">
                                    🗓️ Agendar
                                  </button>
                                  <button type="button" class="btn-sm" style="font-size: 0.70rem; padding: 3px 6px; background: #EBF8EE; color: #1E7E34; border: 1px solid #C6F6D5; border-radius: 4px; cursor: pointer; font-weight: 700;" onclick="app.deductPackageItemSession('${client.id}', '${p.id}', '${this.escapeHtml(i.nome)}')" title="Dar baixa em 1 sessão">
                                    ✓ Baixar
                                  </button>
                                ` : ''}
                                ${(i.feitas || 0) > 0 ? `
                                  <button type="button" class="btn-sm" style="font-size: 0.70rem; padding: 3px 6px; background: #EDF2F7; color: #4A5568; border: 1px solid #CBD5E0; border-radius: 4px; cursor: pointer;" onclick="app.revertPackageItemSession('${client.id}', '${p.id}', '${this.escapeHtml(i.nome)}')" title="Estornar 1 sessão realizada">
                                    ↺ Estornar
                                  </button>
                                ` : ''}
                              </div>
                            </div>
                          </div>
                        `;
                      }).join('')}
                    </div>
                  `;
                })()}

                <!-- Barra de Progresso Geral -->
                <div style="margin: 8px 0 6px 0;">
                  <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.78rem; font-weight: 700; color: #925D11; margin-bottom: 3px;">
                    <span>Sessões Totais: ${p.sessoesFeitas} de ${p.totalSessoes}</span>
                    <span>${pctFeito}%</span>
                  </div>
                  <div style="background: rgba(0,0,0,0.06); border-radius: 10px; height: 6px; overflow: hidden;">
                    <div style="background: var(--primary); width: ${pctFeito}%; height: 100%; border-radius: 10px; transition: width 0.3s ease;"></div>
                  </div>
                </div>

                <!-- Rodapé com Ações -->
                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px; border-top: 1px dashed var(--border-light); padding-top: 6px;">
                  <span style="font-size: 0.76rem; color: var(--text-muted);">
                    💰 Investimento: <strong>${this.formatCurrency(p.valorTotal || 0)}</strong>
                  </span>
                  <div style="display: flex; gap: 6px;">
                    <button type="button" class="btn-sm" style="font-size: 0.72rem; padding: 4px 8px; background: #25D366; color: #fff; border: none; border-radius: 5px; cursor: pointer; display: flex; align-items: center; gap: 4px;" onclick="app.sendPackageReceiptWhatsApp('${client.id}', '${p.id}')">
                      💬 Carteirinha WhatsApp
                    </button>
                    <button type="button" class="btn-sm" style="font-size: 0.72rem; padding: 4px 8px; background: transparent; color: var(--danger); border: 1px solid rgba(185,55,40,0.3); border-radius: 5px; cursor: pointer;" onclick="app.removeClientPackage('${client.id}', '${p.id}')" title="Excluir Plano">
                      🗑️
                    </button>
                  </div>
                </div>
              </div>
            `;
          }).join('') : '<div style="font-size: 0.82rem; color: var(--text-muted); padding: 6px 0;">Nenhum plano contratado para esta cliente. Clique em "+ Ativar / Montar Plano" acima para iniciar.</div>'}
        </div>
      </div>

      <!-- Histórico de Atendimentos Realizados -->
      <div class="card" style="margin-bottom: 16px;">
        <div class="card-title-row">
          <div style="font-weight: 700; font-size: 0.95rem;">📜 Histórico de Atendimentos (${historicoCliente.length})</div>
        </div>

        ${historicoCliente.length === 0 ? `
          <div style="font-size: 0.82rem; color: var(--text-muted); text-align: center; padding: 12px;">
            Nenhum atendimento finalizado ainda para esta cliente.
          </div>
        ` : `
          <div class="history-timeline">
            ${historicoCliente.map(h => `
              <div class="history-card">
                <div class="history-card-header">
                  <span class="history-date">📅 ${this.formatDate(h.data)} às ${h.horario}</span>
                  <span class="history-pill">✓ ${this.formatCurrency(h.valor)} (${(h.formaPagamento || 'PIX').toUpperCase()})</span>
                </div>
                <div class="history-service">${h.servicoNome} ${h.numSessao ? `<span class="app-package-tag">Sessão ${h.numSessao}</span>` : ''}</div>
                
                ${h.suprimentosGastos ? `
                  <div class="history-details-box">
                    <span style="font-weight: 700; color: #8F4B3C;">🧪 Suprimentos gastos:</span>
                    <span>${h.suprimentosGastos}</span>
                  </div>
                ` : ''}

                ${h.evolucaoSessao ? `
                  <div class="history-details-box" style="background: #F4F8F5;">
                    <span style="font-weight: 700; color: #1E7E34;">📝 Evolução da sessão:</span>
                    <span>${h.evolucaoSessao}</span>
                  </div>
                ` : ''}

                ${h.notas ? `
                  <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">
                    📌 <em>${h.notas}</em>
                  </div>
                ` : ''}
              </div>
            `).join('')}
          </div>
        `}
      </div>

      <div style="display: flex; gap: 8px;">
        <button class="btn-complete" style="flex: 1;" onclick="app.openNewAppointmentForClient('${client.id}')">
          🗓️ Agendar para Ela
        </button>
        <button class="icon-btn" style="width: auto; padding: 0 14px; font-size: 0.85rem;" onclick="app.editClient('${client.id}')">
          ✏️ Editar
        </button>
      </div>
    `;

    this.openModal('modal-client-details');
  }

  // Atalho rápido de suprimentos
  appendSupply(supplyText) {
    const textarea = document.getElementById('complete-supplies');
    if (!textarea) return;
    const current = textarea.value.trim();
    if (current) {
      textarea.value = current + ', ' + supplyText;
    } else {
      textarea.value = supplyText;
    }
    textarea.focus();
  }

  async promptAddPackage(clientId) {
    return this.openAddClientPackageModal(clientId);
  }

  // =========================================================================
  // MONTE SEU PLANO (PLANO LIVRE) & ATIVAÇÃO DE PACOTES PARA CLIENTES
  // =========================================================================
  async openAddClientPackageModal(clientId) {
    const client = await db.get('clientes', clientId);
    if (!client) return;

    this._activePackageClientId = clientId;
    const inputClientId = document.getElementById('custom-pkg-client-id');
    if (inputClientId) inputClientId.value = clientId;

    const headerClient = document.getElementById('custom-pkg-client-header');
    if (headerClient) headerClient.textContent = `Para ${client.nome}`;

    // Carrega serviços avulsos da clínica
    this.allServices = await db.getAll('servicos');
    const avulsos = (this.allServices || []).filter(s => !s.isPacote);

    // Inicializa seleções do plano livre
    this._customPlanSelections = {};
    avulsos.forEach(s => {
      this._customPlanSelections[s.id] = 0;
    });

    // Renderiza lista de serviços com steppers [+] [-]
    const stepperContainer = document.getElementById('custom-pkg-services-stepper-list');
    if (stepperContainer) {
      if (avulsos.length === 0) {
        stepperContainer.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 12px; font-size: 0.82rem;">Nenhum procedimento avulso cadastrado.</div>';
      } else {
        stepperContainer.innerHTML = avulsos.map(s => `
          <div id="custom-plan-card-${s.id}" style="display: flex; justify-content: space-between; align-items: center; background: #FFFFFF; border: 1.5px solid var(--border-color); border-radius: 8px; padding: 10px 12px; transition: all 0.2s ease;">
            <div style="flex: 1; min-width: 0; padding-right: 8px;">
              <div style="font-weight: 700; font-size: 0.88rem; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${this.escapeHtml(s.nome)}
              </div>
              <div style="font-size: 0.76rem; color: var(--text-muted); margin-top: 2px;">
                ${s.categoria || 'Geral'} • ${s.duracaoMin || 60} min • <strong style="color: var(--primary);">${this.formatCurrency(s.preco || 0)}</strong>
              </div>
            </div>

            <!-- Stepper +/- -->
            <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
              <button type="button" class="btn-sm" style="width: 32px; height: 32px; font-size: 1.1rem; font-weight: bold; display: flex; align-items: center; justify-content: center; border-radius: 6px; padding: 0; background: var(--bg-card-soft); border: 1px solid var(--border-color); color: var(--text-main); cursor: pointer;" onclick="app.changeCustomPlanQty('${s.id}', -1)">
                −
              </button>
              <span id="custom-qty-${s.id}" style="font-size: 0.95rem; font-weight: 800; min-width: 20px; text-align: center; color: var(--primary);">
                0
              </span>
              <button type="button" class="btn-sm" style="width: 32px; height: 32px; font-size: 1.1rem; font-weight: bold; display: flex; align-items: center; justify-content: center; border-radius: 6px; padding: 0; background: var(--primary); border: 1px solid var(--primary); color: #FFFFFF; cursor: pointer;" onclick="app.changeCustomPlanQty('${s.id}', 1)">
                +
              </button>
            </div>
          </div>
        `).join('');
      }
    }

    // Reseta campos do resumo
    this.updateCustomPlanSummary();

    // Carrega planos pré-cadastrados do catálogo
    const catalogo = await db.getAll('catalogo_pacotes');
    const catalogContainer = document.getElementById('custom-pkg-catalog-list');
    const checkoutBox = document.getElementById('custom-pkg-catalog-checkout');
    if (checkoutBox) checkoutBox.style.display = 'none';

    if (catalogContainer) {
      if (catalogo.length === 0) {
        catalogContainer.innerHTML = `
          <div style="text-align: center; color: var(--text-muted); padding: 20px; font-size: 0.85rem;">
            Nenhum plano cadastrado no catálogo ainda. Use a aba "Monte seu Plano" para criar um protocolo livre sob medida!
          </div>
        `;
      } else {
        catalogContainer.innerHTML = catalogo.map(p => {
          let procs = '';
          if (Array.isArray(p.itens) && p.itens.length > 0) {
            procs = p.itens.map(i => `${i.sessoes}x ${i.nome}`).join(' + ');
          } else if (Array.isArray(p.servicosNomes) && p.servicosNomes.length > 0) {
            procs = p.servicosNomes.join(' + ');
          } else {
            procs = p.servicoNome || '';
          }
          return `
            <div id="catalog-opt-${p.id}" class="card" style="cursor: pointer; border: 1.5px solid var(--border-color); padding: 12px; margin-bottom: 4px; transition: all 0.2s;" onclick="app.selectCatalogPlanForClient('${p.id}')">
              <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div>
                  <div style="font-weight: 700; color: var(--primary); font-size: 0.95rem;">${this.escapeHtml(p.nome)}</div>
                  <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 3px;">
                    💆‍♀️ Composição: <strong>${this.escapeHtml(procs)}</strong>
                  </div>
                  <div style="font-size: 0.76rem; color: var(--text-muted); margin-top: 2px;">
                    🗓️ ${p.qtdSessoes} sessões ${p.validade ? `• Validade: ${p.validade}` : ''}
                  </div>
                </div>
                <div style="font-size: 1rem; font-weight: 800; color: var(--accent-gold-dark);">
                  ${this.formatCurrency(p.preco || 0)}
                </div>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // Abre a aba "builder" por padrão
    this.switchClientPlanTab('builder');
    this.openModal('modal-client-add-package');
  }

  switchClientPlanTab(tab) {
    const btnBuilder = document.getElementById('tab-btn-custom-pkg-builder');
    const btnCatalog = document.getElementById('tab-btn-custom-pkg-catalog');
    const contentBuilder = document.getElementById('tab-content-custom-pkg-builder');
    const contentCatalog = document.getElementById('tab-content-custom-pkg-catalog');

    if (tab === 'builder') {
      if (btnBuilder) {
        btnBuilder.style.background = 'var(--bg-card)';
        btnBuilder.style.color = 'var(--primary)';
        btnBuilder.style.boxShadow = 'var(--shadow-sm)';
        btnBuilder.style.borderColor = 'var(--border-color)';
      }
      if (btnCatalog) {
        btnCatalog.style.background = 'transparent';
        btnCatalog.style.color = 'var(--text-muted)';
        btnCatalog.style.boxShadow = 'none';
        btnCatalog.style.borderColor = 'transparent';
      }
      if (contentBuilder) contentBuilder.style.display = 'flex';
      if (contentCatalog) contentCatalog.style.display = 'none';
    } else {
      if (btnCatalog) {
        btnCatalog.style.background = 'var(--bg-card)';
        btnCatalog.style.color = 'var(--primary)';
        btnCatalog.style.boxShadow = 'var(--shadow-sm)';
        btnCatalog.style.borderColor = 'var(--border-color)';
      }
      if (btnBuilder) {
        btnBuilder.style.background = 'transparent';
        btnBuilder.style.color = 'var(--text-muted)';
        btnBuilder.style.boxShadow = 'none';
        btnBuilder.style.borderColor = 'transparent';
      }
      if (contentBuilder) contentBuilder.style.display = 'none';
      if (contentCatalog) contentCatalog.style.display = 'flex';
    }
  }

  changeCustomPlanQty(serviceId, delta) {
    if (!this._customPlanSelections) this._customPlanSelections = {};
    const current = this._customPlanSelections[serviceId] || 0;
    const next = Math.max(0, current + delta);
    this._customPlanSelections[serviceId] = next;

    const el = document.getElementById(`custom-qty-${serviceId}`);
    if (el) el.textContent = next;

    const card = document.getElementById(`custom-plan-card-${serviceId}`);
    if (card) {
      if (next > 0) {
        card.style.borderColor = 'var(--primary)';
        card.style.background = 'rgba(190, 122, 71, 0.05)';
      } else {
        card.style.borderColor = 'var(--border-color)';
        card.style.background = '#FFFFFF';
      }
    }

    this.updateCustomPlanSummary();
  }

  updateCustomPlanSummary() {
    const avulsos = (this.allServices || []).filter(s => !s.isPacote);
    let totalSessions = 0;
    let originalTotal = 0;
    const items = [];

    for (const [srvId, qty] of Object.entries(this._customPlanSelections || {})) {
      if (qty > 0) {
        const srv = avulsos.find(s => s.id === srvId);
        if (srv) {
          totalSessions += qty;
          originalTotal += (srv.preco || 0) * qty;
          items.push(`${qty}x ${srv.nome}`);
        }
      }
    }

    this._customPlanTotalAvulso = originalTotal;
    this._customPlanTotalSessions = totalSessions;

    // Badge de sessões
    const badge = document.getElementById('custom-pkg-total-sessions-badge');
    if (badge) badge.textContent = `${totalSessions} sessão(ões)`;

    // Composição
    const compEl = document.getElementById('custom-pkg-summary-composition');
    if (compEl) {
      compEl.textContent = items.length > 0 ? items.join(' + ') : 'Nenhum procedimento selecionado.';
    }

    // Valor de tabela cheia
    const origEl = document.getElementById('custom-pkg-original-total');
    if (origEl) origEl.textContent = this.formatCurrency(originalTotal);

    // Sugere nome automático
    const nameInput = document.getElementById('custom-pkg-name');
    if (nameInput) {
      if (items.length === 0) {
        nameInput.value = '';
      } else if (!nameInput.value || nameInput.value.startsWith('Protocolo Sob Medida') || nameInput.value.startsWith('Plano Livre')) {
        nameInput.value = `Protocolo Sob Medida (${totalSessions} Sessões)`;
      }
    }

    // Se o valor final ainda não foi editado manualmente, sugere o valor original
    const priceInput = document.getElementById('custom-pkg-final-price');
    if (priceInput && (!priceInput.value || priceInput.dataset.autoFilled === 'true' || priceInput.value === '0.00')) {
      priceInput.value = originalTotal > 0 ? originalTotal.toFixed(2) : '';
      priceInput.dataset.autoFilled = 'true';
    }

    this.recalculateCustomPlanSavings();
  }

  applyCustomPlanDiscount(discountRate) {
    const originalTotal = this._customPlanTotalAvulso || 0;
    const discounted = Math.round(originalTotal * (1 - discountRate) * 100) / 100;
    const priceInput = document.getElementById('custom-pkg-final-price');
    if (priceInput) {
      priceInput.value = discounted > 0 ? discounted.toFixed(2) : '';
      priceInput.dataset.autoFilled = 'false';
    }
    this.recalculateCustomPlanSavings();
  }

  recalculateCustomPlanSavings() {
    const originalTotal = this._customPlanTotalAvulso || 0;
    const priceInput = document.getElementById('custom-pkg-final-price');
    const finalPrice = parseFloat(priceInput ? priceInput.value : 0) || 0;
    const badge = document.getElementById('custom-pkg-savings-badge');

    if (badge) {
      if (originalTotal > 0 && finalPrice > 0 && finalPrice < originalTotal) {
        const economy = originalTotal - finalPrice;
        const pct = Math.round((economy / originalTotal) * 100);
        badge.textContent = `🎉 Economia da cliente: ${this.formatCurrency(economy)} (${pct}% de desconto)`;
        badge.style.display = 'block';
      } else {
        badge.style.display = 'none';
      }
    }
  }

  async saveCustomClientPlan() {
    const clientId = this._activePackageClientId;
    if (!clientId) return;

    const client = await db.get('clientes', clientId);
    if (!client) return;

    const totalSessions = this._customPlanTotalSessions || 0;
    if (totalSessions <= 0) {
      this.showToast('Selecione pelo menos 1 procedimento com o botão + para montar o plano.');
      return;
    }

    const nomePlano = (document.getElementById('custom-pkg-name').value || '').trim() || `Protocolo Sob Medida (${totalSessions}x)`;
    const valorFinal = parseFloat(document.getElementById('custom-pkg-final-price').value) || 0;
    const validade = document.getElementById('custom-pkg-validity').value;
    const logCashflow = document.getElementById('custom-pkg-log-cashflow').checked;
    const paymentMethod = document.getElementById('custom-pkg-payment-method').value;
    const installments = document.getElementById('custom-pkg-installments').value;

    const avulsos = (this.allServices || []).filter(s => !s.isPacote);
    const items = [];

    for (const [srvId, qty] of Object.entries(this._customPlanSelections || {})) {
      if (qty > 0) {
        const srv = avulsos.find(s => s.id === srvId);
        if (srv) {
          items.push({
            id: srv.id,
            nome: srv.nome,
            sessoes: qty,
            feitas: 0,
            precoUnitario: srv.preco || 0
          });
        }
      }
    }

    const novoPacote = {
      id: 'pct_' + Date.now(),
      tipo: 'plano_livre',
      isPlanoLivre: true,
      servicoNome: nomePlano,
      itens: items,
      servicosNomes: items.map(i => i.nome),
      totalSessoes: totalSessions,
      sessoesFeitas: 0,
      valorTotal: valorFinal,
      valorAvulso: this._customPlanTotalAvulso || valorFinal,
      validade: validade,
      status: 'ativo',
      criadoEm: new Date().toISOString()
    };

    if (!client.pacotes) client.pacotes = [];
    client.pacotes.push(novoPacote);
    await db.put('clientes', client);

    // Registro no Caixa
    if (logCashflow && valorFinal > 0) {
      await db.put('transacoes', {
        id: 'tx_' + Date.now(),
        tipo: 'entrada',
        descricao: `Venda ${nomePlano} (${installments}) - ${client.nome}`,
        categoria: 'pacote',
        valor: valorFinal,
        data: new Date().toISOString().split('T')[0],
        formaPagamento: paymentMethod,
        criadoEm: new Date().toISOString()
      });
    }

    this.closeModal('modal-client-add-package');
    this.showToast(`✨ Plano Livre ativado com sucesso para ${client.nome}!`);
    await this.viewClientDetails(clientId);
    await this.loadTodayTab();

    // Feedback com atalho para WhatsApp da cliente
    this.offerSendCustomPlanReceipt(client, novoPacote);
  }

  async selectCatalogPlanForClient(catalogId) {
    const pkg = await db.get('catalogo_pacotes', catalogId);
    if (!pkg) return;

    this._selectedCatalogPlan = pkg;

    // Destaca visualmente o card selecionado
    const cards = document.querySelectorAll('#custom-pkg-catalog-list > div');
    cards.forEach(c => {
      c.style.borderColor = 'var(--border-color)';
      c.style.background = '#FFFFFF';
    });
    const selCard = document.getElementById(`catalog-opt-${catalogId}`);
    if (selCard) {
      selCard.style.borderColor = 'var(--primary)';
      selCard.style.background = 'rgba(190, 122, 71, 0.08)';
    }

    const checkoutBox = document.getElementById('custom-pkg-catalog-checkout');
    if (checkoutBox) {
      checkoutBox.style.display = 'block';
      document.getElementById('custom-pkg-catalog-sel-name').textContent = `Plano: ${pkg.nome} (${pkg.qtdSessoes} sessões)`;
      document.getElementById('custom-pkg-catalog-price').value = (pkg.preco || 0).toFixed(2);
      checkoutBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  async saveCatalogClientPlan() {
    const clientId = this._activePackageClientId;
    const pkg = this._selectedCatalogPlan;
    if (!clientId || !pkg) return;

    const client = await db.get('clientes', clientId);
    if (!client) return;

    const valorFinal = parseFloat(document.getElementById('custom-pkg-catalog-price').value) || (pkg.preco || 0);
    const paymentMethod = document.getElementById('custom-pkg-catalog-payment-method').value;
    const logCashflow = document.getElementById('custom-pkg-catalog-log-cashflow').checked;

    let servicosNomes = [];
    let itens = [];

    if (Array.isArray(pkg.itens) && pkg.itens.length > 0) {
      itens = pkg.itens.map(i => ({ ...i, feitas: 0 }));
      servicosNomes = pkg.itens.map(i => i.nome);
    } else if (Array.isArray(pkg.servicosNomes) && pkg.servicosNomes.length > 0) {
      servicosNomes = pkg.servicosNomes;
      itens = servicosNomes.map(nome => ({ nome, sessoes: 1, feitas: 0 }));
    } else {
      servicosNomes = [pkg.servicoNome || pkg.nome];
      itens = [{ nome: pkg.servicoNome || pkg.nome, sessoes: pkg.qtdSessoes || 1, feitas: 0 }];
    }

    const novoPacote = {
      id: 'pct_' + Date.now(),
      tipo: 'catalogo',
      servicoNome: pkg.nome,
      servicosNomes: servicosNomes,
      itens: itens,
      totalSessoes: pkg.qtdSessoes || 1,
      sessoesFeitas: 0,
      valorTotal: valorFinal,
      validade: pkg.validade || '60 dias',
      status: 'ativo',
      criadoEm: new Date().toISOString()
    };

    if (!client.pacotes) client.pacotes = [];
    client.pacotes.push(novoPacote);
    await db.put('clientes', client);

    if (logCashflow && valorFinal > 0) {
      await db.put('transacoes', {
        id: 'tx_' + Date.now(),
        tipo: 'entrada',
        descricao: `Venda ${pkg.nome} - ${client.nome}`,
        categoria: 'pacote',
        valor: valorFinal,
        data: new Date().toISOString().split('T')[0],
        formaPagamento: paymentMethod,
        criadoEm: new Date().toISOString()
      });
    }

    this.closeModal('modal-client-add-package');
    this.showToast(`✨ Plano ativado com sucesso para ${client.nome}!`);
    await this.viewClientDetails(clientId);
    await this.loadTodayTab();

    this.offerSendCustomPlanReceipt(client, novoPacote);
  }

  async removeClientPackage(clientId, packageId) {
    if (!confirm('Deseja realmente remover este plano da ficha da cliente?')) return;
    const client = await db.get('clientes', clientId);
    if (!client || !client.pacotes) return;
    client.pacotes = client.pacotes.filter(p => p.id !== packageId);
    await db.put('clientes', client);
    this.showToast('Plano removido.');
    await this.viewClientDetails(clientId);
  }

  async sendPackageReceiptWhatsApp(clientId, packageId) {
    const client = await db.get('clientes', clientId);
    if (!client || !client.pacotes) return;
    const pacote = client.pacotes.find(p => p.id === packageId);
    if (!pacote) return;
    this.offerSendCustomPlanReceipt(client, pacote);
  }

  offerSendCustomPlanReceipt(client, pacote) {
    const cleanWpp = (client.whatsapp || '').replace(/\D/g, '');
    let composicao = '';
    if (Array.isArray(pacote.itens) && pacote.itens.length > 0) {
      composicao = pacote.itens.map(i => `• ${i.sessoes}x ${i.nome} (${i.feitas || 0}/${i.sessoes} realizadas)`).join('\n');
    } else {
      composicao = `• ${pacote.totalSessoes}x ${pacote.servicoNome}`;
    }

    const ecoText = pacote.valorAvulso && pacote.valorAvulso > pacote.valorTotal
      ? `\n🎉 Economia de ${this.formatCurrency(pacote.valorAvulso - pacote.valorTotal)}!`
      : '';

    const msg = encodeURIComponent(
      `Olá, ${client.nome}! ✨\n` +
      `Seu *${pacote.servicoNome}* está ATIVO no Studio Letícia!\n\n` +
      `💆‍♀️ *Composição do seu Protocolo:*\n${composicao}\n\n` +
      `🗓️ *Total:* ${pacote.totalSessoes} sessões\n` +
      `⏳ *Validade:* ${pacote.validade || '60 dias'}\n` +
      `💰 *Investimento:* ${this.formatCurrency(pacote.valorTotal)}${ecoText}\n\n` +
      `Sua primeira sessão já pode ser agendada. Estamos te esperando com muito carinho! 💆‍♀️🌸\n\n` +
      `📍 Endereço: Rua 26, nº 135 - Colmeia Park • Jataí - GO`
    );

    const linkWpp = `https://wa.me/55${cleanWpp}?text=${msg}`;

    this.showBookingActionFeedback({
      icon: '🎉',
      title: 'Plano Ativado com Sucesso!',
      message: `O <strong>${this.escapeHtml(pacote.servicoNome)}</strong> de ${pacote.totalSessoes} sessões foi adicionado à ficha de <strong>${this.escapeHtml(client.nome)}</strong>. Toque abaixo para enviar a carteirinha digital no WhatsApp dela!`,
      wppLink: linkWpp,
      wppLabel: 'Enviar Carteirinha no WhatsApp'
    });
  }

  // Atalho inteligente: Abre agendamento já com a cliente, plano e procedimento selecionados
  openNewAppointmentForClientPackage(clientId, packageId, itemNome) {
    this.closeModal('modal-client-details');
    this.openNewAppointmentModal();
    const clientSelect = document.getElementById('app-client-select');
    if (clientSelect) {
      clientSelect.value = clientId;
      this.onAppointmentClientChange();
    }

    if (packageId) {
      const pkgSelect = document.getElementById('app-package-select');
      if (pkgSelect) {
        pkgSelect.value = packageId;
        this.onAppointmentPackageChange();
      }
    }

    if (itemNome) {
      const itemSelect = document.getElementById('app-package-item-select');
      if (itemSelect) {
        for (let i = 0; i < itemSelect.options.length; i++) {
          if (itemSelect.options[i].value === itemNome) {
            itemSelect.selectedIndex = i;
            break;
          }
        }
        this.onAppointmentPackageItemChange();
      }
    }
  }

  // Baixa manual de 1 sessão direto na ficha da cliente
  async deductPackageItemSession(clientId, packageId, itemNome) {
    const client = await db.get('clientes', clientId);
    if (!client || !client.pacotes) return;
    const pacote = client.pacotes.find(p => p.id === packageId);
    if (!pacote) return;

    let item = (pacote.itens || []).find(i => i.nome === itemNome);
    const procNome = item ? item.nome : (itemNome || pacote.servicoNome);
    const disponiveis = item ? (item.sessoes - (item.feitas || 0)) : (pacote.totalSessoes - (pacote.sessoesFeitas || 0));

    if (disponiveis <= 0) {
      alert(`⚠️ Todas as sessões de "${procNome}" já foram realizadas!`);
      return;
    }

    if (!confirm(`Deseja dar baixa em 1 sessão de "${procNome}" para ${client.nome}?`)) {
      return;
    }

    pacote.sessoesFeitas = Math.min(pacote.totalSessoes, (pacote.sessoesFeitas || 0) + 1);
    if (item) {
      item.feitas = Math.min(item.sessoes, (item.feitas || 0) + 1);
    }

    const allDone = Array.isArray(pacote.itens) && pacote.itens.length > 0
      ? pacote.itens.every(i => (i.feitas || 0) >= i.sessoes)
      : (pacote.sessoesFeitas >= pacote.totalSessoes);

    if (pacote.sessoesFeitas >= pacote.totalSessoes || allDone) {
      pacote.status = 'concluido';
      pacote.concluidoEm = new Date().toISOString();
      this.showToast(`🎉 Parabéns! Pacote "${pacote.servicoNome}" 100% concluído!`);
    } else {
      const realizadas = item ? item.feitas : pacote.sessoesFeitas;
      const total = item ? item.sessoes : pacote.totalSessoes;
      this.showToast(`✓ Sessão de "${procNome}" baixada! (${realizadas}/${total})`);
    }

    await db.put('clientes', client);
    const cIdx = this.allClients.findIndex(c => c.id === client.id);
    if (cIdx !== -1) this.allClients[cIdx] = client;

    await this.viewClientDetails(clientId);
    if (this.currentTab === 'clientes') await this.loadClientsTab();
  }

  // Estorno manual de 1 sessão direto na ficha da cliente
  async revertPackageItemSession(clientId, packageId, itemNome) {
    const client = await db.get('clientes', clientId);
    if (!client || !client.pacotes) return;
    const pacote = client.pacotes.find(p => p.id === packageId);
    if (!pacote) return;

    let item = (pacote.itens || []).find(i => i.nome === itemNome);
    const procNome = item ? item.nome : (itemNome || pacote.servicoNome);
    const feitas = item ? (item.feitas || 0) : (pacote.sessoesFeitas || 0);

    if (feitas <= 0) {
      alert(`⚠️ Não há sessões realizadas de "${procNome}" para estornar.`);
      return;
    }

    if (!confirm(`Deseja estornar 1 sessão de "${procNome}"? Ela voltará a ficar disponível para a cliente.`)) {
      return;
    }

    pacote.sessoesFeitas = Math.max(0, (pacote.sessoesFeitas || 1) - 1);
    if (item) {
      item.feitas = Math.max(0, (item.feitas || 1) - 1);
    }
    pacote.status = 'ativo';
    delete pacote.concluidoEm;

    await db.put('clientes', client);
    const cIdx = this.allClients.findIndex(c => c.id === client.id);
    if (cIdx !== -1) this.allClients[cIdx] = client;

    this.showToast(`↺ 1 sessão de "${procNome}" estornada com sucesso.`);
    await this.viewClientDetails(clientId);
    if (this.currentTab === 'clientes') await this.loadClientsTab();
  }

  // =========================================================================
  // ABA 4: FLUXO DE CAIXA
  // =========================================================================
  async loadCashFlowTab() {
    const transacoes = await db.getAll('transacoes');
    transacoes.sort((a, b) => (b.data + b.id).localeCompare(a.data + a.id));

    let entradas = 0;
    let saidas = 0;

    transacoes.forEach(t => {
      const val = parseFloat(t.valor) || 0;
      if (t.tipo === 'entrada') entradas += val;
      if (t.tipo === 'saida') saidas += val;
    });

    const saldo = entradas - saidas;

    document.getElementById('cash-income').textContent = this.formatCurrency(entradas);
    document.getElementById('cash-expense').textContent = this.formatCurrency(saidas);
    
    const balanceEl = document.getElementById('cash-balance');
    balanceEl.textContent = this.formatCurrency(saldo);
    balanceEl.className = 'finance-val ' + (saldo >= 0 ? 'val-gold' : 'val-red');

    const listContainer = document.getElementById('transactions-list');
    if (!listContainer) return;

    if (transacoes.length === 0) {
      listContainer.innerHTML = `
        <div class="card" style="text-align: center; padding: 20px; color: var(--text-muted);">
          Nenhuma transação registrada ainda.
        </div>
      `;
      return;
    }

    listContainer.innerHTML = transacoes.map(t => {
      const isEntrada = t.tipo === 'entrada';
      return `
        <div class="tx-item">
          <div style="display: flex; align-items: center;">
            <div class="tx-icon ${isEntrada ? 'tx-in' : 'tx-out'}">
              ${isEntrada ? '↓' : '↑'}
            </div>
            <div>
              <div style="font-weight: 700; color: var(--text-main);">${t.descricao}</div>
              <div style="font-size: 0.72rem; color: var(--text-muted);">${this.formatDate(t.data)} • ${(t.formaPagamento || 'PIX').toUpperCase()}</div>
            </div>
          </div>
          <div style="font-weight: 800; font-size: 0.95rem; color: ${isEntrada ? '#2B8A3E' : '#C92A2A'};">
            ${isEntrada ? '+ ' : '- '}${this.formatCurrency(t.valor)}
          </div>
        </div>
      `;
    }).join('');
  }

  async saveExpense(e) {
    e.preventDefault();
    const desc = document.getElementById('expense-desc').value;
    const val = parseFloat(document.getElementById('expense-val').value) || 0;
    const cat = document.getElementById('expense-cat').value;
    const data = document.getElementById('expense-date').value;

    await db.put('transacoes', {
      id: 'tx_' + Date.now(),
      tipo: 'saida',
      descricao: desc,
      categoria: cat,
      valor: val,
      data: data,
      formaPagamento: 'pix',
      criadoEm: new Date().toISOString()
    });

    this.closeModal('modal-expense');
    document.getElementById('form-expense').reset();
    this.showToast('Despesa registrada com sucesso!');
    this.loadCashFlowTab();
  }

  // =========================================================================
  // ABA 5: AJUSTES, TABELA DE PREÇOS, PLANOS & BACKUP
  // =========================================================================
  async loadSettingsTab() {
    this.allServices = await db.getAll('servicos');
    const config = (await db.get('config', 'app_config')) || {};
    const cpfSettingInput = document.getElementById('setting-auth-cpf');
    if (cpfSettingInput && config.authCpf) {
      cpfSettingInput.value = config.authCpf;
    }
    await this.renderUsersList();
    this.setupBookingSettings();
  }

  setupBookingSettings() {
    const isCustomDomain = window.location.hostname === 'estudioleticiaestetica.com.br' || window.location.hostname === 'www.estudioleticiaestetica.com.br';
    const bookingUrl = isCustomDomain 
      ? 'https://estudioleticiaestetica.com.br'
      : (window.location.origin.includes('github.io') ? 'https://estudioleticiaestetica.com.br' : (window.location.origin + window.location.pathname.replace('index.html', '')));
    const display = document.getElementById('booking-public-url-display');
    if (display) display.textContent = bookingUrl;

    const urlInput = document.getElementById('setting-supabase-url');
    const keyInput = document.getElementById('setting-supabase-key');
    if (urlInput) urlInput.value = localStorage.getItem('studio_supabase_url') || '';
    if (keyInput) keyInput.value = localStorage.getItem('studio_supabase_key') || '';
  }

  copyBookingLink() {
    const isCustomDomain = window.location.hostname === 'estudioleticiaestetica.com.br' || window.location.hostname === 'www.estudioleticiaestetica.com.br';
    const bookingUrl = isCustomDomain 
      ? 'https://estudioleticiaestetica.com.br'
      : (window.location.origin.includes('github.io') ? 'https://estudioleticiaestetica.com.br' : (window.location.origin + window.location.pathname.replace('index.html', '')));
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(bookingUrl).then(() => {
        this.showToast('Link do Site Oficial copiado (estudioleticiaestetica.com.br)! 📋✨');
      }).catch(() => {
        prompt('Copie o link do site abaixo para enviar às clientes:', bookingUrl);
      });
    } else {
      prompt('Copie o link do site abaixo para enviar às clientes:', bookingUrl);
    }
  }

  testBookingPage() {
    this.showClientBookingView();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    this.showToast('Visualizando como Cliente! Para voltar, clique em "Acesso da Profissional".');
  }

  saveSupabaseConfig() {
    const url = (document.getElementById('setting-supabase-url').value || '').trim();
    const key = (document.getElementById('setting-supabase-key').value || '').trim();

    if (url) localStorage.setItem('studio_supabase_url', url);
    else localStorage.removeItem('studio_supabase_url');

    if (key) localStorage.setItem('studio_supabase_key', key);
    else localStorage.removeItem('studio_supabase_key');

    if (window.StudioCloud) {
      StudioCloud.init();
    }
    this.showToast('Configuração do Supabase salva com sucesso! ⚡');
    this.checkOnlineRequests();
  }

  // =========================================================================
  // CENTRAL DE ALERTAS & NOTIFICAÇÕES (SUPABASE REALTIME & RESILIENTE)
  // =========================================================================
  async startNotificationSystem() {
    this.requestNotificationPermission();

    // 1. Limpeza preventiva de caches legados do Service Worker
    if ('caches' in window) {
      try {
        const keys = await caches.keys();
        for (const k of keys) {
          if (k.startsWith('studio-leticia-') && k !== 'studio-leticia-v38') {
            await caches.delete(k);
          }
        }
      } catch (_) {}
    }

    // 2. Conexão Realtime com o Supabase
    const cloud = window.StudioCloud || (typeof StudioCloud !== 'undefined' ? StudioCloud : null);
    if (cloud && cloud.subscribeToNewBookings) {
      if (this._realtimeBookingsChannel) {
        try { cloud.unsubscribe(this._realtimeBookingsChannel); } catch (_) {}
      }
      this._realtimeBookingsChannel = cloud.subscribeToNewBookings((newReq) => {
        this.handleIncomingOnlineBooking(newReq);
      });
    }

    // 3. Ouvintes de ciclo de vida para iOS Safari (PWA acordando de segundo plano)
    if (!this._resumeListenersAttached) {
      this._resumeListenersAttached = true;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.onAppResume();
        }
      });
      window.addEventListener('pageshow', () => this.onAppResume());
      window.addEventListener('focus', () => this.onAppResume());

      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', (event) => {
          if (event.data && event.data.type === 'OPEN_ALERTS_PANEL') {
            this.openOnlineRequestsModal();
          }
        });
      }

      if (window.location.hash === '#alertas') {
        setTimeout(() => this.openOnlineRequestsModal(), 300);
      }
    }

    // 4. Checagem imediata inicial
    await this.checkOnlineRequests(true);

    // 5. Polling redundante a cada 15 segundos
    if (this._onlinePoller) clearInterval(this._onlinePoller);
    this._onlinePoller = setInterval(() => this.checkOnlineRequests(false), 15000);
  }

  async onAppResume() {
    console.log('📱 App retomado do segundo plano. Sincronizando notificações...');
    const cloud = window.StudioCloud || (typeof StudioCloud !== 'undefined' ? StudioCloud : null);
    if (cloud && cloud.subscribeToNewBookings) {
      if (this._realtimeBookingsChannel) {
        try { cloud.unsubscribe(this._realtimeBookingsChannel); } catch (_) {}
      }
      this._realtimeBookingsChannel = cloud.subscribeToNewBookings((newReq) => {
        this.handleIncomingOnlineBooking(newReq);
      });
    }

    await this.checkOnlineRequests(false);
    const modal = document.getElementById('modal-online-requests');
    if (modal && modal.classList.contains('active')) {
      const pendList = document.getElementById('online-requests-list');
      if (pendList && pendList.style.display !== 'none') {
        await this.renderOnlineRequests();
      } else {
        await this.renderOnlineHistory();
      }
    }
  }

  requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      try {
        Notification.requestPermission().then((perm) => {
          if (perm === 'granted') {
            console.log('🔔 Permissão de notificação concedida no navegador!');
          }
        });
      } catch (_) {}
    }
  }

  async handleIncomingOnlineBooking(newReq) {
    if (!newReq) return;
    if (newReq.cliente_nome === '__STUDIO_CONFIG_SERVICOS__' || newReq.cliente_nome === '__STUDIO_CONFIG_HORARIOS__') return;
    if (newReq.status !== 'pendente') return;
    if (newReq.observacoes && newReq.observacoes.includes('[APP_ID:')) return;

    if (!this._notifiedBookingIds) this._notifiedBookingIds = new Set();
    if (this._notifiedBookingIds.has(newReq.id)) return;
    this._notifiedBookingIds.add(newReq.id);

    this.playNotificationChime();
    this.flashTabTitle('🔔 Novo Agendamento Recebido!');

    const [ano, mes, dia] = (newReq.data || '').split('-');
    const dataFmt = dia && mes ? `${dia}/${mes}/${ano}` : newReq.data;

    this.showToast(`🔔 Novo pedido de ${newReq.cliente_nome}: ${newReq.servico_nome} (${dataFmt} às ${newReq.horario})!`);

    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const notif = new Notification('Studio Letícia - Novo Agendamento! ✨', {
          body: `${newReq.cliente_nome} solicitou ${newReq.servico_nome} para ${dataFmt} às ${newReq.horario}. Toque para abrir!`,
          icon: 'icons/icon-192.png',
          badge: 'icons/icon-192.png',
          tag: 'novo-agd-' + newReq.id
        });
        notif.onclick = () => {
          window.focus();
          this.openOnlineRequestsModal();
        };
      } catch (err) {
        console.warn('Erro ao disparar Notification:', err);
      }
    }

    const modal = document.getElementById('modal-online-requests');
    if (modal && modal.classList.contains('active')) {
      await this.renderOnlineRequests();
    }

    await this.checkOnlineRequests(false);
  }

  async checkOnlineRequests(isInitial = false) {
    const cloud = window.StudioCloud || (typeof StudioCloud !== 'undefined' ? StudioCloud : null);
    if (!cloud) return;
    try {
      const pending = await cloud.getPendingRequests();
      this._currentPendingRequests = pending || [];
      const count = pending.length;

      // Alerta sonoro e visual caso o número de pedidos pendentes tenha aumentado ou na inicialização
      if (isInitial && count > 0) {
        this.showToast(`🔔 Atenção: Você tem ${count} agendamento(s) pendente(s) aguardando aprovação!`);
        this.playNotificationChime();
        this.flashTabTitle(`🔔 (${count}) Pedidos Pendentes`);
      } else if (!isInitial && this._lastPendingCount !== undefined && count > this._lastPendingCount && count > 0) {
        const novoItem = pending[0];
        if (!this._notifiedBookingIds) this._notifiedBookingIds = new Set();
        if (novoItem && !this._notifiedBookingIds.has(novoItem.id)) {
          this._notifiedBookingIds.add(novoItem.id);
          this.playNotificationChime();
          this.flashTabTitle(`🔔 (${count}) Novo Agendamento!`);
          this.showToast(`🔔 ${count} novo(s) agendamento(s) aguardando aprovação!`);
          if ('Notification' in window && Notification.permission === 'granted') {
            const [ano, mes, dia] = (novoItem.data || '').split('-');
            const dataFmt = dia && mes ? `${dia}/${mes}/${ano}` : novoItem.data;
            try {
              const notif = new Notification('Studio Letícia - Novo Agendamento! ✨', {
                body: `${novoItem.cliente_nome} solicitou ${novoItem.servico_nome} para ${dataFmt} às ${novoItem.horario}`,
                icon: 'icons/icon-192.png',
                tag: 'novo-agd-' + novoItem.id
              });
              notif.onclick = () => {
                window.focus();
                this.openOnlineRequestsModal();
              };
            } catch (_) {}
          }
        }
      }
      this._lastPendingCount = count;

      // 1. Badge do Sininho no Cabeçalho
      const headerBadge = document.getElementById('header-notification-badge');
      if (headerBadge) {
        if (count > 0) {
          headerBadge.textContent = count;
          headerBadge.style.display = 'flex';
        } else {
          headerBadge.style.display = 'none';
        }
      }

      // 2. Badge na aba do Modal (Pendentes)
      const modalBadge = document.getElementById('alerts-badge-tab');
      if (modalBadge) {
        if (count > 0) {
          modalBadge.textContent = count;
          modalBadge.style.display = 'inline-block';
        } else {
          modalBadge.style.display = 'none';
        }
      }

      // 3. Badge na aba do Modal (Histórico)
      const histBadge = document.getElementById('alerts-history-badge-tab');
      if (histBadge) {
        try {
          const allReqs = await cloud.getAllRequests(50);
          if (allReqs && allReqs.length > 0) {
            histBadge.textContent = allReqs.length;
            histBadge.style.display = 'inline-block';
          } else {
            histBadge.style.display = 'none';
          }
        } catch (_) {}
      }

      // 4. Banner da Home
      const banner = document.getElementById('online-requests-banner');
      const countEl = document.getElementById('online-requests-count');
      if (banner && countEl) {
        if (count > 0) {
          countEl.textContent = count;
          banner.style.display = 'block';
        } else {
          banner.style.display = 'none';
        }
      }

      // 5. Bloco de Acesso Rápido da Home
      const homePill = document.getElementById('home-alert-pill');
      const dotBadge = document.getElementById('home-block-badge');
      if (homePill) {
        if (count > 0) {
          homePill.textContent = `${count} pendente${count > 1 ? 's' : ''}`;
          homePill.style.display = 'inline-block';
        } else {
          homePill.style.display = 'none';
        }
      }
      if (dotBadge) {
        dotBadge.style.display = count > 0 ? 'block' : 'none';
      }
    } catch (err) {
      console.warn('Erro ao verificar agendamentos online:', err);
    }
  }

  openOnlineRequestsModal() {
    this.requestNotificationPermission();
    const modal = document.getElementById('modal-online-requests');
    if (modal) {
      modal.classList.add('active');
      this.switchAlertsTab('pendentes');
      this.checkOnlineRequests(false);
    }
  }

  async refreshOnlineRequestsModal() {
    this.showToast('Atualizando notificações... 🔄');
    await this.checkOnlineRequests(false);
    const pendList = document.getElementById('online-requests-list');
    if (pendList && pendList.style.display !== 'none') {
      await this.renderOnlineRequests();
    } else {
      await this.renderOnlineHistory();
    }
  }

  switchAlertsTab(tab) {
    const pendBtn = document.getElementById('alerts-tab-pending-btn');
    const histBtn = document.getElementById('alerts-tab-history-btn');
    const pendList = document.getElementById('online-requests-list');
    const histList = document.getElementById('online-history-list');

    if (tab === 'pendentes') {
      if (pendBtn) {
        pendBtn.style.background = 'var(--bg-card)';
        pendBtn.style.color = 'var(--primary)';
        pendBtn.style.boxShadow = 'var(--shadow-sm)';
        pendBtn.style.borderColor = 'var(--border-color)';
      }
      if (histBtn) {
        histBtn.style.background = 'transparent';
        histBtn.style.color = 'var(--text-muted)';
        histBtn.style.boxShadow = 'none';
        histBtn.style.borderColor = 'transparent';
      }
      if (pendList) pendList.style.display = 'flex';
      if (histList) histList.style.display = 'none';
      this.renderOnlineRequests();
    } else {
      if (histBtn) {
        histBtn.style.background = 'var(--bg-card)';
        histBtn.style.color = 'var(--primary)';
        histBtn.style.boxShadow = 'var(--shadow-sm)';
        histBtn.style.borderColor = 'var(--border-color)';
      }
      if (pendBtn) {
        pendBtn.style.background = 'transparent';
        pendBtn.style.color = 'var(--text-muted)';
        pendBtn.style.boxShadow = 'none';
        pendBtn.style.borderColor = 'transparent';
      }
      if (pendList) pendList.style.display = 'none';
      if (histList) histList.style.display = 'flex';
      this.renderOnlineHistory();
    }
  }

  async renderOnlineRequests() {
    const container = document.getElementById('online-requests-list');
    if (!container) return;

    container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 24px;">Carregando pedidos pendentes e notificações... ⏳</div>';

    try {
      const cloud = window.StudioCloud || (typeof StudioCloud !== 'undefined' ? StudioCloud : null);
      if (!cloud) {
        container.innerHTML = `
          <div class="card" style="text-align: center; color: var(--danger); padding: 20px;">
            <div>Serviço da nuvem indisponível.</div>
            <button type="button" class="btn-sm" style="margin-top: 10px; padding: 6px 12px;" onclick="app.renderOnlineRequests()">🔄 Tentar Novamente</button>
          </div>
        `;
        return;
      }

      const pending = await cloud.getPendingRequests();
      this._currentPendingRequests = pending || [];

      // Busca também os últimos processados para que a Letícia NUNCA veja a lista vazia
      let recentReqs = [];
      try {
        recentReqs = await cloud.getAllRequests(10);
      } catch (_) {}

      // Atualiza badges das abas
      const pBadge = document.getElementById('alerts-badge-tab');
      if (pBadge) {
        if (pending.length > 0) {
          pBadge.textContent = pending.length;
          pBadge.style.display = 'inline-block';
        } else {
          pBadge.style.display = 'none';
        }
      }
      const hBadge = document.getElementById('alerts-history-badge-tab');
      if (hBadge && recentReqs.length > 0) {
        hBadge.textContent = recentReqs.length;
        hBadge.style.display = 'inline-block';
      }

      const allAgendamentos = (typeof db !== 'undefined' && db && db.getAll) ? (await db.getAll('agendamentos')) : [];
      if (!this.allClients || this.allClients.length === 0) {
        if (typeof db !== 'undefined' && db && db.getAll) {
          this.allClients = await db.getAll('clientes');
        }
      }

      let pendingHtml = '';

      if (!pending || pending.length === 0) {
        pendingHtml = `
          <div style="background: linear-gradient(135deg, #FAF7F2, #FFFBF6); border: 1.5px dashed var(--border-color); border-radius: var(--radius-md); text-align: center; padding: 20px 16px; margin-bottom: 14px;">
            <div style="font-size: 2rem; margin-bottom: 4px;">✨</div>
            <div style="font-weight: 700; color: var(--text-main); font-size: 0.95rem;">Nenhum pedido pendente no momento</div>
            <div style="font-size: 0.8rem; margin-top: 4px; color: var(--text-muted); line-height: 1.3;">Todas as solicitações de clientes recebidas estão processadas e confirmadas.</div>
          </div>
        `;
      } else {
        const cards = [];
        for (const req of pending) {
          let conflict = { hasConflict: false };
          try {
            conflict = await this.checkTimeConflict(req.data, req.horario, req.duracao_min || 60);
          } catch (_) {}

          const [ano, mes, dia] = (req.data || '').split('-');
          const dataFormatada = dia && mes ? `${dia}/${mes}/${ano}` : req.data;

          const rawCpf = req.cliente_cpf || (req.observacoes && req.observacoes.match(/\[CPF:\s*([0-9.\-]+)\]/i)?.[1]) || '';
          const cleanCpf = rawCpf.replace(/\D/g, '');
          const cleanWpp = (req.cliente_whatsapp || '').replace(/\D/g, '');

          let matchedClient = null;
          if (Array.isArray(this.allClients)) {
            if (cleanCpf && cleanCpf.length === 11) {
              matchedClient = this.allClients.find(c => c && c.cpf && c.cpf.replace(/\D/g, '') === cleanCpf);
            }
            if (!matchedClient && cleanWpp) {
              matchedClient = this.allClients.find(c => c && c.whatsapp && c.whatsapp.replace(/\D/g, '') === cleanWpp);
            }
            if (!matchedClient && req.cliente_nome) {
              matchedClient = this.allClients.find(c => c && c.nome && typeof c.nome === 'string' && c.nome.trim().toLowerCase() === req.cliente_nome.trim().toLowerCase());
            }
          }

          const pastCount = (matchedClient && Array.isArray(allAgendamentos)) ? allAgendamentos.filter(a => a && a.clienteId === matchedClient.id && a.status === 'concluido').length : 0;

          const msgWpp = encodeURIComponent(`Olá, ${req.cliente_nome}! Aqui é a Letícia do Studio Letícia sobre sua solicitação de agendamento para ${dataFormatada} às ${req.horario} (${req.servico_nome}).\n\n📍 Nosso Endereço: Rua 26, nº 135 - Colmeia Park\n🗺️ Localização no Google Maps: https://maps.google.com/?q=-17.858556,-51.716417`);
          const linkWpp = cleanWpp ? `https://wa.me/55${cleanWpp}?text=${msgWpp}` : '#';

          const obsLimpa = (req.observacoes || '')
            .replace(/\[CPF:\s*[0-9.\-]+\]/i, '')
            .replace(/\[Procedimentos:[^\]]*\]/i, '')
            .trim();

          cards.push(`
            <div id="req-card-${req.id}" style="background: var(--bg-card-tint); border: 2px solid var(--accent-gold); border-radius: var(--radius-md); padding: 16px; position: relative; box-shadow: var(--shadow-sm); margin-bottom: 14px;">
              
              <!-- Identificação de Perfil: Recorrente vs Nova -->
              ${matchedClient ? `
                <div style="display: flex; align-items: center; justify-content: space-between; background: linear-gradient(135deg, #FAF2EA, #FFF8F0); border: 1px solid var(--accent-gold); border-radius: 8px; padding: 6px 10px; margin-bottom: 10px;">
                  <div style="font-size: 0.78rem; color: var(--accent-gold-dark); font-weight: 700;">
                    🌟 CLIENTE RECORRENTE • ${pastCount} atendimento(s) realizado(s)
                  </div>
                  <button type="button" class="btn-sm" style="font-size: 0.72rem; padding: 4px 8px; background: var(--primary); color: #fff; border-radius: 5px; border: none; cursor: pointer;" onclick="app.viewClientDetails('${matchedClient.id}')">
                    👁️ Ver Ficha
                  </button>
                </div>
              ` : `
                <div style="display: inline-block; background: #EBF4FC; color: #1D6F93; border: 1px solid #B8E0F7; border-radius: 6px; padding: 3px 8px; font-size: 0.74rem; font-weight: 700; margin-bottom: 10px;">
                  🆕 NOVA CLIENTE • Primeiro Atendimento
                </div>
              `}

              <!-- Dados da Cliente -->
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
                <div>
                  <div style="font-size: 1.05rem; font-weight: 800; color: var(--primary);">${this.escapeHtml(req.cliente_nome || 'Cliente')}</div>
                  <div style="font-size: 0.82rem; color: var(--text-main); margin-top: 2px;">
                    📱 <strong>WhatsApp:</strong> ${this.formatPhone(req.cliente_whatsapp)}
                  </div>
                  ${cleanCpf ? `
                    <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 1px;">
                      🪪 <strong>CPF:</strong> ${this.formatCPF(cleanCpf)}
                    </div>
                  ` : ''}
                </div>
                <span style="background: #FFF4E5; color: #925D11; font-size: 0.72rem; font-weight: bold; padding: 4px 8px; border-radius: 6px;">Pendente</span>
              </div>

              <!-- Card do Serviço Solicitado -->
              <div style="background: #FFFFFF; border: 1px solid var(--border-light); border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; font-size: 0.85rem;">
                <div style="font-weight: 700; color: var(--text-main);">${this.escapeHtml(req.servico_nome || 'Procedimento')}</div>
                <div style="color: var(--text-muted); margin-top: 2px;">
                  🗓️ <strong>${dataFormatada}</strong> às <strong>${req.horario}</strong> (${req.duracao_min || 60} min)
                </div>
                <div style="color: var(--primary); font-weight: bold; margin-top: 2px;">
                  Valor: ${this.formatCurrency(req.servico_preco || 0)}
                </div>
                ${obsLimpa ? `<div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 6px; background: #FAF7F2; padding: 6px; border-radius: 5px;">📝 "${this.escapeHtml(obsLimpa)}"</div>` : ''}
              </div>

              <!-- Alerta de Conflito de Horário na Agenda -->
              ${conflict.hasConflict ? `
                <div style="background: #FBEBEB; border: 1px solid #F5C6C6; color: var(--danger); font-size: 0.78rem; padding: 8px 10px; border-radius: 8px; margin-bottom: 12px;">
                  ⚠️ <strong>Atenção:</strong> Você já possui agendamento neste horário (${conflict.intervalo})!
                </div>
              ` : `
                <div style="background: #EBF8EE; border: 1px solid #C6EED0; color: #1E7E34; font-size: 0.78rem; padding: 6px 10px; border-radius: 8px; margin-bottom: 12px;">
                  🟢 <strong>Horário Livre</strong> na sua agenda.
                </div>
              `}

              <!-- Ações em 1 Toque -->
              <div id="req-actions-${req.id}" style="display: flex; gap: 8px; flex-wrap: wrap;">
                <button type="button" class="btn-complete" style="flex: 1.5; min-width: 130px; padding: 10px 8px; font-size: 0.85rem;" onclick="app.confirmOnlineRequest('${req.id}')">
                  ✅ Confirmar
                </button>
                <button type="button" class="quick-btn" style="flex: 1.5; min-width: 140px; justify-content: center; font-size: 0.82rem; color: var(--primary); border-color: var(--primary); padding: 10px 8px; font-weight: 700; background: rgba(190, 122, 71, 0.08);" onclick="app.openRescheduleModal('${req.id}')">
                  🕒 Encaixar / Mudar
                </button>
                ${cleanWpp ? `
                  <a href="${linkWpp}" target="_blank" class="quick-btn" style="flex: 1; min-width: 95px; text-decoration: none; justify-content: center; font-size: 0.82rem; color: var(--green-wpp-dark); border-color: rgba(37,211,102,0.4); padding: 10px 6px;">
                    💬 WhatsApp
                  </a>
                ` : ''}
                <button type="button" class="quick-btn" style="flex: 1; min-width: 80px; justify-content: center; color: var(--danger); border-color: rgba(185,55,40,0.3); padding: 10px 6px; font-size: 0.85rem;" onclick="app.openRejectModal('${req.id}')">
                  ❌ Recusar
                </button>
              </div>
            </div>
          `);
        }
        pendingHtml = cards.join('');
      }

      // Renderiza também histórico recente logo abaixo para que todas as notificações existentes sejam visíveis
      let recentHtml = '';
      if (recentReqs && recentReqs.length > 0) {
        recentHtml = `
          <div style="margin-top: 8px; border-top: 1.5px solid var(--border-light); padding-top: 14px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
              <div style="font-size: 0.82rem; font-weight: 800; color: var(--text-main); letter-spacing: 0.3px;">
                📜 NOTIFICAÇÕES &amp; PEDIDOS RECENTES (${recentReqs.length})
              </div>
              <button type="button" class="quick-btn" style="font-size: 0.72rem; padding: 4px 10px; color: var(--primary); border-color: var(--primary); font-weight: 700;" onclick="app.switchAlertsTab('historico')">
                Ver Histórico Completo →
              </button>
            </div>
            <div style="display: flex; flex-direction: column; gap: 8px;">
              ${recentReqs.map(r => {
                const [ano, mes, dia] = (r.data || '').split('-');
                const dataFmt = dia && mes ? `${dia}/${mes}/${ano}` : r.data;
                const cleanWpp = (r.cliente_whatsapp || '').replace(/\D/g, '');
                const obs = r.observacoes || '';
                const isEncaixe = obs.includes('[ENCAIXE_HORARIO:');

                let badge = '<span style="background: #EBF8EE; color: #1E7E34; font-size: 0.7rem; font-weight: 700; padding: 3px 8px; border-radius: 5px;">🟢 Confirmado</span>';
                if (isEncaixe) {
                  badge = '<span style="background: #E8F4FD; color: #1971C2; font-size: 0.7rem; font-weight: 700; padding: 3px 8px; border-radius: 5px;">🕒 Confirmado (Encaixe)</span>';
                } else if (r.status === 'recusado') {
                  badge = '<span style="background: #FBEBEB; color: #C53030; font-size: 0.7rem; font-weight: 700; padding: 3px 8px; border-radius: 5px;">❌ Recusado</span>';
                } else if (r.status === 'pendente') {
                  badge = '<span style="background: #FFF4E5; color: #925D11; font-size: 0.7rem; font-weight: 700; padding: 3px 8px; border-radius: 5px;">⏳ Pendente</span>';
                }

                const msgWpp = encodeURIComponent(`Olá, ${r.cliente_nome}! Aqui é a Letícia do Studio Letícia.`);
                const linkWpp = cleanWpp ? `https://wa.me/55${cleanWpp}?text=${msgWpp}` : '#';

                return `
                  <div style="background: #FFFFFF; border: 1px solid var(--border-light); border-radius: 8px; padding: 10px 12px; font-size: 0.82rem; box-shadow: var(--shadow-sm);">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                      <div>
                        <div style="font-weight: 700; color: var(--primary); font-size: 0.92rem;">${this.escapeHtml(r.cliente_nome || 'Cliente')}</div>
                        <div style="color: var(--text-muted); font-size: 0.76rem; margin-top: 2px;">
                          📱 ${this.formatPhone(r.cliente_whatsapp)} • 🗓️ <strong>${dataFmt}</strong> às <strong>${r.horario}</strong>
                        </div>
                      </div>
                      <div style="display: flex; gap: 6px; align-items: center;">
                        ${badge}
                        ${cleanWpp ? `<a href="${linkWpp}" target="_blank" class="icon-btn" style="width: 26px; height: 26px; font-size: 0.75rem; text-decoration: none;" title="WhatsApp">💬</a>` : ''}
                      </div>
                    </div>
                    <div style="margin-top: 4px; color: var(--text-main); font-size: 0.8rem;">
                      <strong>${this.escapeHtml(r.servico_nome || 'Procedimento')}</strong> • ${this.formatCurrency(r.servico_preco || 0)}
                    </div>
                    ${r.motivo_recusa ? `<div style="font-size: 0.74rem; color: var(--danger); margin-top: 3px;">❌ <em>Motivo: ${this.escapeHtml(r.motivo_recusa)}</em></div>` : ''}
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }

      container.innerHTML = `
        <div style="display: flex; flex-direction: column;">
          ${pendingHtml}
          ${recentHtml}
        </div>
      `;

      this.checkOnlineRequests();
    } catch (err) {
      console.error('Erro ao renderizar solicitações pendentes:', err);
      container.innerHTML = `
        <div class="card" style="text-align: center; color: var(--danger); padding: 20px;">
          <div>Falha ao carregar solicitações: ${err.message || 'Erro de conexão'}</div>
          <button type="button" class="btn-sm" style="margin-top: 10px; padding: 6px 12px;" onclick="app.renderOnlineRequests()">🔄 Tentar Novamente</button>
        </div>
      `;
    }
  }

  async renderOnlineHistory(filter = 'todos') {
    const container = document.getElementById('online-history-list');
    if (!container) return;

    if (!this._cachedOnlineHistory) {
      container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px;">Carregando histórico de pedidos... ⏳</div>';
    }

    try {
      const cloud = window.StudioCloud || (typeof StudioCloud !== 'undefined' ? StudioCloud : null);
      if (!cloud) {
        container.innerHTML = `
          <div class="card" style="text-align: center; color: var(--danger); padding: 20px;">
            <div>Serviço da nuvem indisponível.</div>
            <button type="button" class="btn-sm" style="margin-top: 10px; padding: 6px 12px;" onclick="app.renderOnlineHistory()">🔄 Tentar Novamente</button>
          </div>
        `;
        return;
      }

      const allRequests = await cloud.getAllRequests(50);
      this._cachedOnlineHistory = allRequests || [];

      if (!allRequests || allRequests.length === 0) {
        container.innerHTML = `
          <div class="card" style="text-align: center; color: var(--text-muted); padding: 30px 20px;">
            <div style="font-size: 2rem; margin-bottom: 8px;">📜</div>
            <div style="font-weight: 600; color: var(--text-main);">Nenhum pedido no histórico</div>
          </div>
        `;
        return;
      }

      // Filtro por status
      let filtered = allRequests;
      if (filter === 'confirmados') {
        filtered = allRequests.filter(r => r.status === 'confirmado' && (!r.observacoes || !r.observacoes.includes('[ENCAIXE_HORARIO:')));
      } else if (filter === 'encaixes') {
        filtered = allRequests.filter(r => r.observacoes && r.observacoes.includes('[ENCAIXE_HORARIO:'));
      } else if (filter === 'recusados') {
        filtered = allRequests.filter(r => r.status === 'recusado');
      } else if (filter === 'pendentes') {
        filtered = allRequests.filter(r => r.status === 'pendente');
      }

      const filterButtonsHtml = `
        <div style="display: flex; gap: 6px; overflow-x: auto; padding-bottom: 8px; margin-bottom: 8px;">
          <button type="button" class="quick-btn" style="font-size: 0.72rem; padding: 4px 8px; border-radius: 12px; ${filter === 'todos' ? 'background: var(--primary); color: #fff; font-weight: 700;' : ''}" onclick="app.renderOnlineHistory('todos')">Todos (${allRequests.length})</button>
          <button type="button" class="quick-btn" style="font-size: 0.72rem; padding: 4px 8px; border-radius: 12px; ${filter === 'confirmados' ? 'background: #1E7E34; color: #fff; font-weight: 700;' : ''}" onclick="app.renderOnlineHistory('confirmados')">🟢 Confirmados</button>
          <button type="button" class="quick-btn" style="font-size: 0.72rem; padding: 4px 8px; border-radius: 12px; ${filter === 'encaixes' ? 'background: #1971C2; color: #fff; font-weight: 700;' : ''}" onclick="app.renderOnlineHistory('encaixes')">🕒 Encaixes</button>
          <button type="button" class="quick-btn" style="font-size: 0.72rem; padding: 4px 8px; border-radius: 12px; ${filter === 'recusados' ? 'background: #C53030; color: #fff; font-weight: 700;' : ''}" onclick="app.renderOnlineHistory('recusados')">❌ Recusados</button>
        </div>
      `;

      if (filtered.length === 0) {
        container.innerHTML = `
          ${filterButtonsHtml}
          <div class="card" style="text-align: center; color: var(--text-muted); padding: 20px;">
            <div>Nenhum pedido com este filtro.</div>
          </div>
        `;
        return;
      }

      const htmls = filtered.map(req => {
        const [ano, mes, dia] = (req.data || '').split('-');
        const dataFormatada = dia && mes ? `${dia}/${mes}/${ano}` : req.data;
        const cleanWpp = (req.cliente_whatsapp || '').replace(/\D/g, '');
        const rawCpf = req.cliente_cpf || (req.observacoes && req.observacoes.match(/\[CPF:\s*([0-9.\-]+)\]/i)?.[1]) || '';

        const obs = req.observacoes || '';
        const isEncaixe = obs.includes('[ENCAIXE_HORARIO:');

        let statusBadge = '<span style="background: #EBF8EE; color: #1E7E34; font-size: 0.72rem; font-weight: bold; padding: 3px 8px; border-radius: 6px;">🟢 Confirmado</span>';
        if (isEncaixe) {
          statusBadge = '<span style="background: #E8F4FD; color: #1971C2; font-size: 0.72rem; font-weight: bold; padding: 3px 8px; border-radius: 6px;">🕒 Confirmado (Encaixe)</span>';
        } else if (req.status === 'recusado') {
          statusBadge = '<span style="background: #FBEBEB; color: #C53030; font-size: 0.72rem; font-weight: bold; padding: 3px 8px; border-radius: 6px;">❌ Recusado</span>';
        } else if (req.status === 'pendente') {
          statusBadge = '<span style="background: #FFF4E5; color: #925D11; font-size: 0.72rem; font-weight: bold; padding: 3px 8px; border-radius: 6px;">⏳ Pendente</span>';
        }

        const msgWpp = encodeURIComponent(`Olá, ${req.cliente_nome}! Aqui é a Letícia do Studio Letícia.`);
        const linkWpp = cleanWpp ? `https://wa.me/55${cleanWpp}?text=${msgWpp}` : '#';

        const obsLimpa = obs
          .replace(/\[CPF:\s*[0-9.\-]+\]/i, '')
          .replace(/\[Procedimentos:[^\]]*\]/i, '')
          .replace(/\[ENCAIXE_HORARIO:[^\]]*\]/i, '')
          .trim();

        return `
          <div style="background: #FFFFFF; border: 1px solid var(--border-light); border-radius: var(--radius-md); padding: 12px 14px; box-shadow: var(--shadow-sm);">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
              <div>
                <div style="font-weight: 700; color: var(--primary); font-size: 0.95rem;">${this.escapeHtml(req.cliente_nome || 'Cliente')}</div>
                <div style="font-size: 0.78rem; color: var(--text-muted);">
                  📱 ${this.formatPhone(req.cliente_whatsapp)} ${rawCpf ? `• 🪪 ${this.formatCPF(rawCpf)}` : ''}
                </div>
              </div>
              <div style="display: flex; gap: 6px; align-items: center;">
                ${statusBadge}
                ${cleanWpp ? `
                  <a href="${linkWpp}" target="_blank" class="icon-btn" style="width: 28px; height: 28px; font-size: 0.8rem; text-decoration: none;" title="Conversar no WhatsApp">💬</a>
                ` : ''}
              </div>
            </div>

            <div style="font-size: 0.82rem; color: var(--text-main);">
              <strong>${this.escapeHtml(req.servico_nome || 'Procedimento')}</strong> • 🗓️ <strong>${dataFormatada}</strong> às <strong>${req.horario}</strong> • ${this.formatCurrency(req.servico_preco || 0)}
            </div>

            ${isEncaixe ? `
              <div style="font-size: 0.76rem; color: #1971C2; background: #E8F4FD; padding: 4px 8px; border-radius: 5px; margin-top: 4px; display: inline-block;">
                🕒 <strong>Horário Ajustado / Encaixe</strong> confirmado pela Letícia no app
              </div>
            ` : ''}

            ${obsLimpa ? `<div style="font-size: 0.76rem; color: var(--text-muted); margin-top: 4px;">📝 <em>${this.escapeHtml(obsLimpa)}</em></div>` : ''}
            ${req.motivo_recusa ? `<div style="font-size: 0.76rem; color: var(--danger); margin-top: 4px;">❌ <strong>Motivo da recusa:</strong> "${this.escapeHtml(req.motivo_recusa)}"</div>` : ''}
          </div>
        `;
      });

      container.innerHTML = filterButtonsHtml + htmls.join('');
    } catch (err) {
      console.error('Erro ao renderizar histórico de pedidos:', err);
      container.innerHTML = `
        <div class="card" style="text-align: center; color: var(--danger); padding: 20px;">
          <div>Falha ao carregar histórico: ${err.message || 'Erro de conexão'}</div>
          <button type="button" class="btn-sm" style="margin-top: 10px; padding: 6px 12px;" onclick="app.renderOnlineHistory()">🔄 Tentar Novamente</button>
        </div>
      `;
    }
  }

  async confirmOnlineRequest(requestId) {
    const cardEl = document.getElementById(`req-card-${requestId}`);
    const actionButtonsEl = document.getElementById(`req-actions-${requestId}`);
    if (actionButtonsEl) {
      actionButtonsEl.innerHTML = `
        <div style="color: var(--primary); font-weight: 700; text-align: center; padding: 10px; width: 100%;">
          ⏳ Confirmando horário na agenda...
        </div>
      `;
    }

    try {
      let req = (this._currentPendingRequests || []).find(r => r.id === requestId);
      if (!req) {
        req = await StudioCloud.getBookingRequestById(requestId);
      }
      if (!req) {
        this.showToast('Solicitação não encontrada.');
        await this.renderOnlineRequests();
        return;
      }

      const rawCpf = req.cliente_cpf || (req.observacoes && req.observacoes.match(/\[CPF:\s*([0-9.\-]+)\]/i)?.[1]) || '';
      const cleanCpf = rawCpf.replace(/\D/g, '');
      const cleanWpp = (req.cliente_whatsapp || '').replace(/\D/g, '');

      // 1. Atualiza status no Supabase (assim a tela da cliente muda para CONFIRMADO)
      await StudioCloud.confirmBooking(requestId);

      // 2. Busca ou cria o cadastro da cliente
      if (!this.allClients || this.allClients.length === 0) {
        this.allClients = await db.getAll('clientes');
      }

      let cliente = null;
      if (cleanCpf && cleanCpf.length === 11 && Array.isArray(this.allClients)) {
        cliente = this.allClients.find(c => c && c.cpf && c.cpf.replace(/\D/g, '') === cleanCpf);
      }
      if (!cliente && cleanWpp && Array.isArray(this.allClients)) {
        cliente = this.allClients.find(c => c && c.whatsapp && c.whatsapp.replace(/\D/g, '') === cleanWpp);
      }
      if (!cliente && req.cliente_nome && Array.isArray(this.allClients)) {
        cliente = this.allClients.find(c => c && c.nome && typeof c.nome === 'string' && c.nome.trim().toLowerCase() === req.cliente_nome.trim().toLowerCase());
      }

      if (cliente) {
        if (!cliente.cpf && cleanCpf) {
          cliente.cpf = cleanCpf;
          await db.put('clientes', cliente);
        }
      } else {
        cliente = {
          id: 'cli_' + Date.now(),
          nome: req.cliente_nome,
          cpf: cleanCpf,
          whatsapp: cleanWpp,
          nascimento: '',
          peso: '',
          preferenciaSessao: 'Com música relaxante',
          notas: 'Cadastrada automaticamente via Agendamento Online',
          anamnese: {
            queixaPrincipal: (req.observacoes || '').replace(/\[CPF:\s*[0-9.\-]+\]/i, '').replace(/\[Procedimentos:[^\]]*\]/i, '').trim() || 'Agendamento pelo site',
            cirurgiaRecente: '',
            alergias: '',
            restricoes: '',
            peso: ''
          },
          pacotes: [],
          criadoEm: new Date().toISOString()
        };
        await db.put('clientes', cliente);
        this.allClients.push(cliente);
        this.populateClientSelects();
      }

      // 3. Insere o agendamento na grade local da Letícia
      const obsLimpa = (req.observacoes || '')
        .replace(/\[CPF:\s*[0-9.\-]+\]/i, '')
        .replace(/\[Procedimentos:[^\]]*\]/i, '')
        .trim();

      const novoAgendamento = {
        id: 'agd_' + Date.now(),
        clienteId: cliente.id,
        clienteNome: cliente.nome,
        whatsapp: cliente.whatsapp,
        servicoId: req.servico_id || 'srv_1',
        servicoNome: req.servico_nome,
        valor: parseFloat(req.servico_preco) || 0,
        data: req.data,
        horario: req.horario,
        duracaoMin: req.duracao_min || 60,
        status: 'agendado',
        pago: false,
        formaPagamento: '',
        notas: obsLimpa,
        criadoEm: new Date().toISOString()
      };

      await db.put('agendamentos', novoAgendamento);

      // Bloqueia o slot na nuvem
      await StudioCloud.blockSlotOnCloud(novoAgendamento);

      // 4. Remove card da tela e atualiza listas e contadores imediatamente
      if (cardEl) cardEl.remove();
      this._currentPendingRequests = (this._currentPendingRequests || []).filter(r => r.id !== requestId);
      this.showToast(`Agendamento de ${cliente.nome} CONFIRMADO com sucesso! 🎉`);

      await this.renderOnlineRequests();
      this.checkOnlineRequests(false);
      await this.loadTodayTab();
      if (this.currentTab === 'agenda') await this.loadAgendaTab();

      // 5. Abre modal de feedback com atalho seguro para WhatsApp
      const [ano, mes, dia] = (req.data || '').split('-');
      const dataFormatada = dia && mes ? `${dia}/${mes}/${ano}` : req.data;
      const msg = encodeURIComponent(`Olá, ${cliente.nome}! ✨ Passando para confirmar que seu horário no Studio Letícia foi CONFIRMADO com sucesso para ${dataFormatada} às ${req.horario} (${req.servico_nome}). Te espero com carinho! 💆‍♀️🌸\n\n📍 Endereço: Rua 26, nº 135 - Colmeia Park\n🗺️ Google Maps: https://maps.google.com/?q=-17.858556,-51.716417`);
      const linkWpp = `https://wa.me/55${cleanWpp}?text=${msg}`;

      this.showBookingActionFeedback({
        icon: '🎉',
        title: 'Agendamento Confirmado!',
        message: `O agendamento de <strong>${this.escapeHtml(cliente.nome)}</strong> para <strong>${dataFormatada} às ${req.horario}</strong> (${this.escapeHtml(req.servico_nome)}) foi registrado com sucesso na sua agenda e atualizado em tempo real na tela da cliente!`,
        wppLink: linkWpp,
        wppLabel: 'Enviar Confirmação no WhatsApp'
      });
    } catch (err) {
      console.error('Erro confirmOnlineRequest:', err);
      this.showToast('Erro ao confirmar: ' + (err.message || 'Erro de conexão'));
      await this.renderOnlineRequests();
    }
  }

  openRescheduleModal(requestId) {
    let req = (this._currentPendingRequests || []).find(r => r.id === requestId);
    if (!req) return;

    const [ano, mes, dia] = (req.data || '').split('-');
    const dataFormatada = dia && mes ? `${dia}/${mes}/${ano}` : req.data;

    document.getElementById('reschedule-request-id').value = req.id;
    document.getElementById('reschedule-client-name').textContent = req.cliente_nome || 'Cliente';
    document.getElementById('reschedule-client-phone').textContent = '📱 ' + this.formatPhone(req.cliente_whatsapp);
    document.getElementById('reschedule-service-name').textContent = `${req.servico_nome || 'Procedimento'} (${this.formatCurrency(req.servico_preco || 0)})`;
    document.getElementById('reschedule-orig-slot').textContent = `${dataFormatada} às ${req.horario}`;
    
    const dateInput = document.getElementById('reschedule-new-date');
    dateInput.value = req.data || new Date().toISOString().split('T')[0];
    dateInput.min = new Date().toISOString().split('T')[0];

    document.getElementById('reschedule-new-time').value = req.horario || '14:00';
    document.getElementById('reschedule-note').value = 'Ajustado com a cliente via WhatsApp';

    this.openModal('modal-reschedule-request');
  }

  async confirmRescheduleBooking(e) {
    if (e) e.preventDefault();
    const requestId = document.getElementById('reschedule-request-id').value;
    const novaData = document.getElementById('reschedule-new-date').value;
    const novoHorario = document.getElementById('reschedule-new-time').value;
    const motivo = document.getElementById('reschedule-note').value.trim();

    if (!requestId || !novaData || !novoHorario) {
      this.showToast('Por favor, selecione a nova data e o novo horário.');
      return;
    }

    const btnSubmit = document.getElementById('btn-submit-reschedule');
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.textContent = 'Salvando Encaixe... ⏳';
    }

    try {
      let req = (this._currentPendingRequests || []).find(r => r.id === requestId);
      if (!req) {
        req = await StudioCloud.getBookingRequestById(requestId);
      }
      if (!req) {
        this.showToast('Solicitação não encontrada.');
        this.closeModal('modal-reschedule-request');
        await this.renderOnlineRequests();
        return;
      }

      const [anoOrig, mesOrig, diaOrig] = (req.data || '').split('-');
      const dataOrigFmt = diaOrig && mesOrig ? `${diaOrig}/${mesOrig}/${anoOrig}` : req.data;
      const horaOrig = req.horario;

      // 1. Atualiza na nuvem com status confirmado e nova data/horário
      await StudioCloud.rescheduleAndConfirmBooking(requestId, novaData, novoHorario, motivo);

      // 2. Busca ou cria o cadastro da cliente
      const rawCpf = req.cliente_cpf || (req.observacoes && req.observacoes.match(/\[CPF:\s*([0-9.\-]+)\]/i)?.[1]) || '';
      const cleanCpf = rawCpf.replace(/\D/g, '');
      const cleanWpp = (req.cliente_whatsapp || '').replace(/\D/g, '');

      if (!this.allClients || this.allClients.length === 0) {
        this.allClients = await db.getAll('clientes');
      }

      let cliente = null;
      if (cleanCpf && cleanCpf.length === 11 && Array.isArray(this.allClients)) {
        cliente = this.allClients.find(c => c && c.cpf && c.cpf.replace(/\D/g, '') === cleanCpf);
      }
      if (!cliente && cleanWpp && Array.isArray(this.allClients)) {
        cliente = this.allClients.find(c => c && c.whatsapp && c.whatsapp.replace(/\D/g, '') === cleanWpp);
      }
      if (!cliente && req.cliente_nome && Array.isArray(this.allClients)) {
        cliente = this.allClients.find(c => c && c.nome && typeof c.nome === 'string' && c.nome.trim().toLowerCase() === req.cliente_nome.trim().toLowerCase());
      }

      if (cliente) {
        if (!cliente.cpf && cleanCpf) {
          cliente.cpf = cleanCpf;
          await db.put('clientes', cliente);
        }
      } else {
        cliente = {
          id: 'cli_' + Date.now(),
          nome: req.cliente_nome,
          cpf: cleanCpf,
          whatsapp: cleanWpp,
          nascimento: '',
          peso: '',
          preferenciaSessao: 'Com música relaxante',
          notas: 'Cadastrada automaticamente via Agendamento Online (Encaixe)',
          anamnese: {
            queixaPrincipal: (req.observacoes || '').replace(/\[CPF:\s*[0-9.\-]+\]/i, '').replace(/\[Procedimentos:[^\]]*\]/i, '').trim() || 'Agendamento pelo site',
            cirurgiaRecente: '',
            alergias: '',
            restricoes: '',
            peso: ''
          },
          pacotes: [],
          criadoEm: new Date().toISOString()
        };
        await db.put('clientes', cliente);
        this.allClients.push(cliente);
        this.populateClientSelects();
      }

      // 3. Insere o agendamento com a NOVA data e NOVO horário na agenda da Letícia
      const obsLimpa = (req.observacoes || '')
        .replace(/\[CPF:\s*[0-9.\-]+\]/i, '')
        .replace(/\[Procedimentos:[^\]]*\]/i, '')
        .trim();
      const notaEncaixe = `[Encaixe/Horário Ajustado] Solicitado originalmente para ${dataOrigFmt} às ${horaOrig}.${motivo ? ` Motivo: ${motivo}.` : ''} ${obsLimpa}`.trim();

      const novoAgendamento = {
        id: 'agd_' + Date.now(),
        clienteId: cliente.id,
        clienteNome: cliente.nome,
        whatsapp: cliente.whatsapp,
        servicoId: req.servico_id || 'srv_1',
        servicoNome: req.servico_nome,
        valor: parseFloat(req.servico_preco) || 0,
        data: novaData,
        horario: novoHorario,
        duracaoMin: req.duracao_min || 60,
        status: 'agendado',
        pago: false,
        formaPagamento: '',
        notas: notaEncaixe,
        criadoEm: new Date().toISOString()
      };

      await db.put('agendamentos', novoAgendamento);

      // Bloqueia o novo slot na nuvem
      await StudioCloud.blockSlotOnCloud(novoAgendamento);

      // 4. Fecha modal de reagendamento
      this.closeModal('modal-reschedule-request');

      // 5. Remove da lista de pendentes e atualiza UI
      const cardEl = document.getElementById(`req-card-${requestId}`);
      if (cardEl) cardEl.remove();
      this._currentPendingRequests = (this._currentPendingRequests || []).filter(r => r.id !== requestId);

      const [anoNova, mesNova, diaNova] = novaData.split('-');
      const novaDataFmt = `${diaNova}/${mesNova}/${anoNova}`;
      this.showToast(`Encaixe de ${cliente.nome} confirmado para ${novaDataFmt} às ${novoHorario}! ✨`);

      await this.renderOnlineRequests();
      this.checkOnlineRequests(false);
      await this.loadTodayTab();
      if (this.currentTab === 'agenda') await this.loadAgendaTab();

      // 6. Modal de ação WhatsApp com horário ajustado
      const msg = encodeURIComponent(`Olá, ${cliente.nome}! ✨ Passando para confirmar que seu horário no Studio Letícia foi AJUSTADO E CONFIRMADO para ${novaDataFmt} às ${novoHorario} (${req.servico_nome}). Te espero com carinho! 💆‍♀️🌸\n\n📍 Endereço: Rua 26, nº 135 - Colmeia Park\n🗺️ Google Maps: https://maps.google.com/?q=-17.858556,-51.716417`);
      const linkWpp = `https://wa.me/55${cleanWpp}?text=${msg}`;

      this.showBookingActionFeedback({
        icon: '🕒',
        title: 'Encaixe Confirmado!',
        message: `O agendamento de <strong>${this.escapeHtml(cliente.nome)}</strong> foi ajustado para <strong>${novaDataFmt} às ${novoHorario}</strong> e registrado na sua agenda! A tela da cliente também foi atualizada em tempo real.`,
        wppLink: linkWpp,
        wppLabel: 'Avisar Cliente no WhatsApp (Horário Ajustado)'
      });
    } catch (err) {
      console.error('Erro confirmRescheduleBooking:', err);
      this.showToast('Erro ao confirmar encaixe: ' + (err.message || 'Erro de conexão'));
      await this.renderOnlineRequests();
    } finally {
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.textContent = '✨ Confirmar Encaixe & Salvar';
      }
    }
  }

  openRejectModal(requestId) {
    let req = (this._currentPendingRequests || []).find(r => r.id === requestId);
    if (!req) return;

    const [ano, mes, dia] = (req.data || '').split('-');
    const dataFormatada = dia && mes ? `${dia}/${mes}/${ano}` : req.data;

    document.getElementById('reject-request-id').value = req.id;
    document.getElementById('reject-summary-client').textContent = req.cliente_nome || 'Cliente';
    document.getElementById('reject-summary-details').textContent = `${req.servico_nome || 'Procedimento'} • ${dataFormatada} às ${req.horario}`;
    document.getElementById('reject-reason').value = 'Horário indisponível no momento.';

    this.openModal('modal-reject-request');
  }

  async confirmRejectBooking(e) {
    if (e) e.preventDefault();
    const requestId = document.getElementById('reject-request-id').value;
    const motivo = document.getElementById('reject-reason').value.trim() || 'Horário indisponível no momento.';

    if (!requestId) return;

    const btnSubmit = document.getElementById('btn-submit-reject');
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.textContent = 'Recusando... ⏳';
    }

    try {
      let req = (this._currentPendingRequests || []).find(r => r.id === requestId);
      if (!req) {
        req = await StudioCloud.getBookingRequestById(requestId);
      }

      // 1. Atualiza na nuvem
      await StudioCloud.rejectBooking(requestId, motivo);

      // 2. Fecha modal de recusa
      this.closeModal('modal-reject-request');

      // 3. Remove da lista de pendentes e atualiza UI
      const cardEl = document.getElementById(`req-card-${requestId}`);
      if (cardEl) cardEl.remove();
      this._currentPendingRequests = (this._currentPendingRequests || []).filter(r => r.id !== requestId);

      this.showToast('Solicitação recusada.');

      await this.renderOnlineRequests();
      this.checkOnlineRequests(false);

      // 4. Modal de feedback para sugerir outro horário no WhatsApp
      if (req) {
        const cleanWpp = (req.cliente_whatsapp || '').replace(/\D/g, '');
        const [ano, mes, dia] = (req.data || '').split('-');
        const dataFormatada = dia && mes ? `${dia}/${mes}/${ano}` : req.data;
        const msg = encodeURIComponent(`Olá, ${req.cliente_nome}! Aqui é a Letícia do Studio Letícia. Infelizmente o horário das ${req.horario} do dia ${dataFormatada} já estava reservado (${motivo}). Podemos verificar outro dia ou horário para você?`);
        const linkWpp = `https://wa.me/55${cleanWpp}?text=${msg}`;

        this.showBookingActionFeedback({
          icon: '❌',
          title: 'Solicitação Recusada',
          message: `A solicitação de <strong>${this.escapeHtml(req.cliente_nome)}</strong> para <strong>${dataFormatada} às ${req.horario}</strong> foi recusada. O motivo "<em>${this.escapeHtml(motivo)}</em>" já está visível na tela dela.`,
          wppLink: linkWpp,
          wppLabel: 'Sugerir Outro Horário no WhatsApp'
        });
      }
    } catch (err) {
      console.error('Erro confirmRejectBooking:', err);
      this.showToast('Erro ao recusar: ' + (err.message || 'Erro de conexão'));
      await this.renderOnlineRequests();
    } finally {
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.textContent = '❌ Confirmar Recusa';
      }
    }
  }

  showBookingActionFeedback({ icon, title, message, wppLink, wppLabel }) {
    const iconEl = document.getElementById('feedback-action-icon');
    const titleEl = document.getElementById('feedback-action-title');
    const msgEl = document.getElementById('feedback-action-message');
    const wppBtn = document.getElementById('feedback-action-wpp-btn');
    const wppLbl = document.getElementById('feedback-action-wpp-label');

    if (iconEl) iconEl.textContent = icon || '✨';
    if (titleEl) titleEl.textContent = title || 'Ação Concluída';
    if (msgEl) msgEl.innerHTML = message || '';

    if (wppBtn && wppLink) {
      wppBtn.href = wppLink;
      wppBtn.style.display = 'flex';
      if (wppLbl) wppLbl.textContent = wppLabel || 'Enviar no WhatsApp';
    } else if (wppBtn) {
      wppBtn.style.display = 'none';
    }

    this.openModal('modal-booking-feedback-action');
  }

  // Janela: Tabela de Preços
  async openPriceTableModal() {
    this.allServices = await db.getAll('servicos');
    this.allServices.sort((a, b) => (a.categoria || '').localeCompare(b.categoria || '') || a.nome.localeCompare(b.nome));

    const container = document.getElementById('price-table-full-list');
    if (container) {
      if (this.allServices.length === 0) {
        container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 20px;">Nenhum procedimento cadastrado.</div>`;
      } else {
        container.innerHTML = this.allServices.map(s => {
          const isVisibleOnSite = s.visivelNoSite !== false && !s.isPacote;
          const statusBadge = isVisibleOnSite 
            ? `<span style="background: rgba(16, 185, 129, 0.12); color: #059669; font-size: 0.72rem; padding: 2px 8px; border-radius: 999px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">🌐 No Site</span>`
            : `<span style="background: rgba(107, 114, 128, 0.12); color: #4B5563; font-size: 0.72rem; padding: 2px 8px; border-radius: 999px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">🔒 Apenas Interno</span>`;

          return `
            <div style="background: var(--bg-card-soft); border: 1px solid var(--border-light); border-radius: var(--radius-md); padding: 14px; display: flex; justify-content: space-between; align-items: center; gap: 12px;">
              <div style="flex: 1; min-width: 0;">
                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                  <span style="font-weight: 700; font-size: 0.95rem; color: var(--text-main);">${s.nome}</span>
                  ${statusBadge}
                </div>
                <div style="font-size: 0.76rem; color: var(--text-muted); margin-top: 3px;">
                  📁 ${s.categoria || 'Geral'} • ⏱️ ${s.duracaoMin || 60} minutos
                </div>
                ${s.descricao ? `<div style="font-size: 0.74rem; color: var(--text-muted); margin-top: 4px; line-height: 1.3; font-style: italic;">${s.descricao}</div>` : ''}
              </div>
              <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
                <strong style="font-size: 1.05rem; color: var(--primary); white-space: nowrap;">${this.formatCurrency(s.preco)}</strong>
                <button class="icon-btn" style="width: 34px; height: 34px; font-size: 0.85rem;" onclick="app.openEditServiceModal('${s.id}')" title="Editar Procedimento Completo">✏️</button>
                <button class="icon-btn" style="width: 34px; height: 34px; font-size: 0.85rem; color: var(--danger);" onclick="app.deleteService('${s.id}')" title="Excluir Procedimento">🗑️</button>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    this.openModal('modal-price-table');
  }

  async openEditServiceModal(id) {
    const servico = await db.get('servicos', id);
    if (!servico) return;

    const title = document.getElementById('modal-service-title');
    if (title) title.textContent = 'Editar Procedimento';

    const srvId = document.getElementById('srv-id');
    if (srvId) srvId.value = servico.id;

    const srvName = document.getElementById('srv-name');
    if (srvName) srvName.value = servico.nome || '';

    const srvPrice = document.getElementById('srv-price');
    if (srvPrice) srvPrice.value = servico.preco || 0;

    const srvDuration = document.getElementById('srv-duration');
    if (srvDuration) srvDuration.value = servico.duracaoMin || 60;

    const srvCat = document.getElementById('srv-cat');
    if (srvCat) srvCat.value = servico.categoria || 'Corporal';

    const srvDesc = document.getElementById('srv-desc');
    if (srvDesc) srvDesc.value = servico.descricao || '';

    const srvVisible = document.getElementById('srv-visible-site');
    if (srvVisible) srvVisible.checked = (servico.visivelNoSite !== false);

    const btnSubmit = document.getElementById('btn-save-service');
    if (btnSubmit) btnSubmit.textContent = 'Salvar Alterações & Atualizar Site ✨';

    this.openModal('modal-service');
  }

  async editServicePrice(id) {
    const servico = await db.get('servicos', id);
    if (!servico) return;

    const novoPreco = prompt(`Alterar valor de "${servico.nome}":\n\nNovo valor em R$:`, servico.preco);
    if (novoPreco === null) return;

    const valorFloat = parseFloat(novoPreco.replace(',', '.')) || 0;
    servico.preco = valorFloat;
    await db.put('servicos', servico);
    await this.syncServicesToCloud(true);
    await this.loadInitialData();
    await this.openPriceTableModal();
    this.showToast('Preço atualizado com sucesso! ✨');
  }

  // Janela: Planos & Pacotes de Tratamento
  async openPackagesCatalogModal() {
    const catalogo = await db.getAll('catalogo_pacotes');
    const container = document.getElementById('packages-catalog-full-list');

    if (container) {
      if (catalogo.length === 0) {
        container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 20px;">Nenhum plano cadastrado no momento.</div>`;
      } else {
        container.innerHTML = catalogo.map(p => {
          // Detalhamento de sessões por procedimento
          let detalheItensHtml = '';
          if (Array.isArray(p.itens) && p.itens.length > 0) {
            detalheItensHtml = p.itens.map(i => `
              <span style="font-size: 0.76rem; color: var(--text-main); background: #FAF7F2; border: 1.5px solid var(--border-color); padding: 3px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px; font-weight: 600;">
                💆‍♀️ <strong>${i.sessoes}x</strong> ${this.escapeHtml(i.nome)}
              </span>
            `).join('');
          } else {
            // Retrocompatibilidade inteligente para planos legados (ex: Plano Despertar)
            const procs = Array.isArray(p.servicosNomes) && p.servicosNomes.length > 0 
              ? p.servicosNomes 
              : (p.servicoNome ? p.servicoNome.split(' + ') : ['Procedimento']);
            
            const sessoesPorProc = procs.length > 1 ? Math.max(1, Math.round((p.qtdSessoes || procs.length) / procs.length)) : (p.qtdSessoes || 1);
            detalheItensHtml = procs.map(procName => `
              <span style="font-size: 0.76rem; color: var(--text-main); background: #FAF7F2; border: 1.5px solid var(--border-color); padding: 3px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px; font-weight: 600;">
                💆‍♀️ <strong>${sessoesPorProc}x</strong> ${this.escapeHtml(procName.trim())}
              </span>
            `).join('');
          }

          return `
            <div style="background: var(--bg-card-tint); border: 1px solid var(--border-color); border-left: 4px solid var(--primary); border-radius: var(--radius-md); padding: 14px; position: relative;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;">
                <div style="flex: 1; min-width: 0;">
                  <div style="font-weight: 800; font-size: 1rem; color: var(--text-main);">${this.escapeHtml(p.nome)}</div>
                  
                  <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 6px;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                      <span style="font-size: 0.76rem; font-weight: 800; color: var(--primary); background: var(--primary-light); padding: 3px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;">
                        ✨ Total: ${p.qtdSessoes} Sessões
                      </span>
                    </div>
                    <div style="display: flex; flex-wrap: wrap; gap: 5px;">
                      ${detalheItensHtml}
                    </div>
                  </div>

                  ${p.frequenciaTexto ? `<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 6px;">📅 ${this.escapeHtml(p.frequenciaTexto)}</div>` : ''}
                  ${p.descricao ? `<div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 4px;"><em>${this.escapeHtml(p.descricao)}</em></div>` : ''}
                </div>
                <div style="text-align: right; flex-shrink: 0;">
                  <div style="font-size: 1.1rem; font-weight: 800; color: var(--primary);">${this.formatCurrency(p.preco)}</div>
                  <div style="display: flex; gap: 4px; justify-content: flex-end; margin-top: 6px;">
                    <button class="icon-btn" style="width: 28px; height: 28px; font-size: 0.8rem;" onclick="app.openEditPackageModal('${p.id}')" title="Editar Plano">✏️</button>
                    <button class="icon-btn" style="width: 28px; height: 28px; font-size: 0.8rem;" onclick="app.deletePackageCatalog('${p.id}')" title="Excluir Plano">🗑️</button>
                  </div>
                </div>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    this.openModal('modal-packages-catalog');
  }

  async openNewPackageModal() {
    this.allServices = await db.getAll('servicos');
    const services = (this.allServices || []).filter(s => !s.isPacote);
    const container = document.getElementById('pkg-services-checkboxes');
    const title = document.getElementById('modal-new-package-title');
    const submitBtn = document.getElementById('pkg-submit-btn');
    const editIdInput = document.getElementById('pkg-edit-id');

    if (title) title.textContent = 'Cadastrar Plano / Pacote';
    if (submitBtn) submitBtn.textContent = 'Salvar Plano no Catálogo';
    if (editIdInput) editIdInput.value = '';

    document.getElementById('form-new-package').reset();
    document.getElementById('pkg-sessions').value = '1';

    if (container) {
      if (services.length === 0) {
        container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 14px; font-size: 0.84rem;">Nenhum procedimento cadastrado. Adicione procedimentos primeiro na Tabela de Preços.</div>`;
      } else {
        container.innerHTML = services.map((s, idx) => {
          const safeId = 'pkg_proc_' + idx;
          return `
            <div class="pkg-proc-item-card" id="card-${safeId}" style="border: 1.5px solid var(--border-color); background: var(--bg-card); border-radius: 8px; padding: 10px; transition: all 0.2s ease;">
              <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; user-select: none; margin: 0;">
                <input type="checkbox" name="pkg-service-item" id="cb-${safeId}" value="${this.escapeHtml(s.nome)}" style="width: 20px; height: 20px; accent-color: var(--primary); cursor: pointer; flex-shrink: 0;" onchange="app.onPkgServiceToggle('${safeId}')">
                <div style="flex: 1; min-width: 0;">
                  <div style="font-weight: 700; font-size: 0.88rem; color: var(--text-main); line-height: 1.3;">${this.escapeHtml(s.nome)}</div>
                  <div style="font-size: 0.74rem; color: var(--text-muted); margin-top: 1px;">${s.categoria || 'Geral'} • ${this.formatCurrency(s.preco)} (avulso)</div>
                </div>
              </label>

              <div id="qty-box-${safeId}" style="display: none; align-items: center; justify-content: space-between; margin-top: 8px; padding-top: 8px; border-top: 1px dashed rgba(77,38,18,0.2);">
                <span style="font-size: 0.78rem; font-weight: 700; color: var(--primary);">Sessões deste procedimento:</span>
                <div style="display: flex; align-items: center; gap: 6px;">
                  <button type="button" onclick="app.stepPkgServiceQty('${safeId}', -1)" style="width: 28px; height: 28px; border-radius: 6px; border: 1.5px solid var(--border-color); background: var(--bg-card); font-weight: bold; font-size: 1rem; color: var(--primary); cursor: pointer; display: flex; align-items: center; justify-content: center; line-height: 1;">−</button>
                  <input type="number" id="qty-${safeId}" data-proc-name="${this.escapeHtml(s.nome)}" value="1" min="1" max="99" style="width: 48px; height: 28px; text-align: center; font-weight: 800; font-size: 0.95rem; border: 1.5px solid var(--primary); border-radius: 6px; padding: 2px; color: var(--primary); background: #FFF;" oninput="app.recalculatePkgTotalSessions()">
                  <span style="font-size: 0.76rem; color: var(--text-muted);">sessão(ões)</span>
                  <button type="button" onclick="app.stepPkgServiceQty('${safeId}', 1)" style="width: 28px; height: 28px; border-radius: 6px; border: 1.5px solid var(--border-color); background: var(--bg-card); font-weight: bold; font-size: 1rem; color: var(--primary); cursor: pointer; display: flex; align-items: center; justify-content: center; line-height: 1;">+</button>
                </div>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    this.recalculatePkgTotalSessions();
    this.openModal('modal-new-package');
  }

  async openEditPackageModal(id) {
    const pkg = await db.get('catalogo_pacotes', id);
    if (!pkg) return;

    this.allServices = await db.getAll('servicos');
    const services = (this.allServices || []).filter(s => !s.isPacote);
    const container = document.getElementById('pkg-services-checkboxes');
    const title = document.getElementById('modal-new-package-title');
    const submitBtn = document.getElementById('pkg-submit-btn');
    const editIdInput = document.getElementById('pkg-edit-id');

    if (title) title.textContent = 'Editar Plano / Pacote';
    if (submitBtn) submitBtn.textContent = 'Salvar Alterações';
    if (editIdInput) editIdInput.value = pkg.id;

    document.getElementById('pkg-name').value = pkg.nome || '';
    document.getElementById('pkg-price').value = pkg.preco !== undefined ? pkg.preco : '';
    document.getElementById('pkg-validity').value = pkg.frequenciaTexto || '';
    document.getElementById('pkg-desc').value = pkg.descricao || '';

    // Mapeamento de procedimentos e respectivas sessões
    const sessionMap = {};
    if (Array.isArray(pkg.itens) && pkg.itens.length > 0) {
      pkg.itens.forEach(i => {
        if (i && i.nome) sessionMap[i.nome.trim()] = i.sessoes || 1;
      });
    } else {
      const procs = Array.isArray(pkg.servicosNomes) && pkg.servicosNomes.length > 0
        ? pkg.servicosNomes
        : (pkg.servicoNome ? pkg.servicoNome.split(' + ').map(s => s.trim()) : []);
      
      const sessoesPorProc = procs.length > 1 ? Math.max(1, Math.round((pkg.qtdSessoes || procs.length) / procs.length)) : (pkg.qtdSessoes || 1);
      procs.forEach(pName => {
        sessionMap[pName.trim()] = sessoesPorProc;
      });
    }

    if (container) {
      if (services.length === 0) {
        container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 14px; font-size: 0.84rem;">Nenhum procedimento cadastrado.</div>`;
      } else {
        container.innerHTML = services.map((s, idx) => {
          const safeId = 'pkg_proc_' + idx;
          const sName = (s.nome || '').trim();
          const isChecked = sName in sessionMap;
          const qty = sessionMap[sName] || 1;

          return `
            <div class="pkg-proc-item-card" id="card-${safeId}" style="border: 1.5px solid ${isChecked ? 'var(--primary)' : 'var(--border-color)'}; background: ${isChecked ? '#FAF4EE' : 'var(--bg-card)'}; border-radius: 8px; padding: 10px; transition: all 0.2s ease;">
              <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; user-select: none; margin: 0;">
                <input type="checkbox" name="pkg-service-item" id="cb-${safeId}" value="${this.escapeHtml(s.nome)}" ${isChecked ? 'checked' : ''} style="width: 20px; height: 20px; accent-color: var(--primary); cursor: pointer; flex-shrink: 0;" onchange="app.onPkgServiceToggle('${safeId}')">
                <div style="flex: 1; min-width: 0;">
                  <div style="font-weight: 700; font-size: 0.88rem; color: var(--text-main); line-height: 1.3;">${this.escapeHtml(s.nome)}</div>
                  <div style="font-size: 0.74rem; color: var(--text-muted); margin-top: 1px;">${s.categoria || 'Geral'} • ${this.formatCurrency(s.preco)} (avulso)</div>
                </div>
              </label>

              <div id="qty-box-${safeId}" style="display: ${isChecked ? 'flex' : 'none'}; align-items: center; justify-content: space-between; margin-top: 8px; padding-top: 8px; border-top: 1px dashed rgba(77,38,18,0.2);">
                <span style="font-size: 0.78rem; font-weight: 700; color: var(--primary);">Sessões deste procedimento:</span>
                <div style="display: flex; align-items: center; gap: 6px;">
                  <button type="button" onclick="app.stepPkgServiceQty('${safeId}', -1)" style="width: 28px; height: 28px; border-radius: 6px; border: 1.5px solid var(--border-color); background: var(--bg-card); font-weight: bold; font-size: 1rem; color: var(--primary); cursor: pointer; display: flex; align-items: center; justify-content: center; line-height: 1;">−</button>
                  <input type="number" id="qty-${safeId}" data-proc-name="${this.escapeHtml(s.nome)}" value="${qty}" min="1" max="99" style="width: 48px; height: 28px; text-align: center; font-weight: 800; font-size: 0.95rem; border: 1.5px solid var(--primary); border-radius: 6px; padding: 2px; color: var(--primary); background: #FFF;" oninput="app.recalculatePkgTotalSessions()">
                  <span style="font-size: 0.76rem; color: var(--text-muted);">sessão(ões)</span>
                  <button type="button" onclick="app.stepPkgServiceQty('${safeId}', 1)" style="width: 28px; height: 28px; border-radius: 6px; border: 1.5px solid var(--border-color); background: var(--bg-card); font-weight: bold; font-size: 1rem; color: var(--primary); cursor: pointer; display: flex; align-items: center; justify-content: center; line-height: 1;">+</button>
                </div>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    this.recalculatePkgTotalSessions();
    this.openModal('modal-new-package');
  }

  onPkgServiceToggle(safeId) {
    const cb = document.getElementById(`cb-${safeId}`);
    const card = document.getElementById(`card-${safeId}`);
    const qtyBox = document.getElementById(`qty-box-${safeId}`);
    const qtyInput = document.getElementById(`qty-${safeId}`);

    if (cb && card && qtyBox) {
      if (cb.checked) {
        card.style.borderColor = 'var(--primary)';
        card.style.background = '#FAF4EE';
        qtyBox.style.display = 'flex';
        if (qtyInput && (!qtyInput.value || parseInt(qtyInput.value, 10) < 1)) {
          qtyInput.value = '1';
        }
      } else {
        card.style.borderColor = 'var(--border-color)';
        card.style.background = 'var(--bg-card)';
        qtyBox.style.display = 'none';
      }
    }

    this.recalculatePkgTotalSessions();
  }

  stepPkgServiceQty(safeId, delta) {
    const qtyInput = document.getElementById(`qty-${safeId}`);
    const cb = document.getElementById(`cb-${safeId}`);
    if (qtyInput) {
      let current = parseInt(qtyInput.value, 10) || 1;
      current = Math.max(1, Math.min(99, current + delta));
      qtyInput.value = current;

      if (cb && !cb.checked) {
        cb.checked = true;
        this.onPkgServiceToggle(safeId);
        return;
      }

      this.recalculatePkgTotalSessions();
    }
  }

  recalculatePkgTotalSessions() {
    const checked = document.querySelectorAll('input[name="pkg-service-item"]:checked');
    let total = 0;

    checked.forEach(cb => {
      const safeId = cb.id.replace('cb-', '');
      const qtyInput = document.getElementById(`qty-${safeId}`);
      const qty = parseInt(qtyInput ? qtyInput.value : '1', 10) || 1;
      total += qty;
    });

    const totalInput = document.getElementById('pkg-sessions');
    if (totalInput) {
      totalInput.value = total > 0 ? total : 1;
    }

    const countBadge = document.getElementById('pkg-services-count');
    if (countBadge) {
      if (checked.length === 0) {
        countBadge.textContent = '0 selecionado(s)';
        countBadge.style.background = 'rgba(77, 38, 18, 0.08)';
        countBadge.style.color = 'var(--primary)';
      } else {
        countBadge.textContent = `${checked.length} proc. (${total} sessões no total)`;
        countBadge.style.background = 'rgba(190, 122, 71, 0.22)';
        countBadge.style.color = '#381A0B';
      }
    }
  }

  toggleAllPkgServices(checkAll = true) {
    const checkboxes = document.querySelectorAll('input[name="pkg-service-item"]');
    checkboxes.forEach(cb => {
      cb.checked = checkAll;
      const safeId = cb.id.replace('cb-', '');
      const card = document.getElementById(`card-${safeId}`);
      const qtyBox = document.getElementById(`qty-box-${safeId}`);
      const qtyInput = document.getElementById(`qty-${safeId}`);
      if (card && qtyBox) {
        if (checkAll) {
          card.style.borderColor = 'var(--primary)';
          card.style.background = '#FAF4EE';
          qtyBox.style.display = 'flex';
          if (qtyInput && (!qtyInput.value || parseInt(qtyInput.value, 10) < 1)) {
            qtyInput.value = '1';
          }
        } else {
          card.style.borderColor = 'var(--border-color)';
          card.style.background = 'var(--bg-card)';
          qtyBox.style.display = 'none';
        }
      }
    });

    this.recalculatePkgTotalSessions();
  }

  async savePackageCatalog(e) {
    if (e) e.preventDefault();
    try {
      const editId = (document.getElementById('pkg-edit-id')?.value || '').trim();
      const nome = (document.getElementById('pkg-name').value || '').trim();
      const checkboxes = document.querySelectorAll('input[name="pkg-service-item"]:checked');

      if (!nome) {
        alert('Por favor, informe o nome do plano/pacote.');
        return;
      }

      if (checkboxes.length === 0) {
        alert('Por favor, selecione pelo menos um procedimento incluído no plano.');
        return;
      }

      const itens = [];
      checkboxes.forEach(cb => {
        const safeId = cb.id.replace('cb-', '');
        const qtyInput = document.getElementById(`qty-${safeId}`);
        const sessoes = parseInt(qtyInput ? qtyInput.value : '1', 10) || 1;
        itens.push({
          nome: cb.value.trim(),
          sessoes: sessoes
        });
      });

      const qtdSessoes = itens.reduce((sum, item) => sum + item.sessoes, 0);
      const servicosNomes = itens.map(i => i.nome);
      const servicoNome = itens.map(i => `${i.sessoes}x ${i.nome}`).join(' + ');
      const preco = parseFloat(document.getElementById('pkg-price').value) || 0;
      const validade = document.getElementById('pkg-validity').value || '';
      const desc = document.getElementById('pkg-desc').value || '';

      if (editId) {
        const existing = await db.get('catalogo_pacotes', editId) || {};
        await db.put('catalogo_pacotes', {
          ...existing,
          id: editId,
          nome,
          servicoNome,
          servicosNomes,
          itens,
          qtdSessoes,
          frequenciaTexto: validade,
          preco,
          descricao: desc,
          atualizadoEm: new Date().toISOString()
        });
        this.showToast('Plano atualizado com sucesso! ✨');
      } else {
        await db.put('catalogo_pacotes', {
          id: 'pct_cat_' + Date.now(),
          nome,
          servicoNome,
          servicosNomes,
          itens,
          qtdSessoes,
          frequenciaTexto: validade,
          preco,
          descricao: desc,
          criadoEm: new Date().toISOString()
        });
        this.showToast('Plano cadastrado com sucesso no Catálogo! 📦✨');
      }

      this.closeModal('modal-new-package');
      await this.openPackagesCatalogModal();
    } catch (err) {
      console.error('Erro ao salvar plano:', err);
      alert('Erro ao salvar plano: ' + err.message);
    }
  }

  async deletePackageCatalog(id) {
    if (confirm('Deseja realmente remover este plano do catálogo?')) {
      await db.delete('catalogo_pacotes', id);
      this.showToast('Plano removido.');
      await this.openPackagesCatalogModal();
    }
  }

  async saveService(e) {
    e.preventDefault();
    const idField = document.getElementById('srv-id');
    const existingId = idField ? idField.value.trim() : '';

    const nome = (document.getElementById('srv-name')?.value || '').trim();
    const preco = parseFloat(document.getElementById('srv-price')?.value) || 0;
    const duracaoMin = parseInt(document.getElementById('srv-duration')?.value, 10) || 60;
    const categoria = document.getElementById('srv-cat')?.value || 'Corporal';
    const descricao = (document.getElementById('srv-desc')?.value || '').trim();
    const visivelNoSite = document.getElementById('srv-visible-site') ? document.getElementById('srv-visible-site').checked : true;

    if (!nome) {
      this.showToast('Informe o nome do procedimento.');
      return;
    }

    const id = existingId || ('srv_' + Date.now());
    const isEdit = !!existingId;

    await db.put('servicos', {
      id,
      nome,
      preco,
      duracaoMin,
      categoria,
      descricao,
      visivelNoSite,
      isPacote: categoria === 'Pacotes'
    });

    await this.syncServicesToCloud(true);
    this.closeModal('modal-service');
    const form = document.getElementById('form-service');
    if (form) form.reset();
    await this.loadInitialData();
    await this.openPriceTableModal();
    this.showToast(isEdit ? 'Procedimento atualizado e site sincronizado! ✨' : 'Procedimento cadastrado e site sincronizado! ✨');
  }

  async deleteService(id) {
    const servico = await db.get('servicos', id);
    const nome = servico ? servico.nome : 'este procedimento';
    if (confirm(`Deseja realmente excluir "${nome}" da tabela e remover do site?`)) {
      await db.delete('servicos', id);
      await this.syncServicesToCloud(true);
      await this.loadInitialData();
      await this.openPriceTableModal();
      this.showToast('Procedimento excluído e site atualizado.');
    }
  }

  // Backup em arquivo .JSON para o celular / iPhone
  async downloadBackup() {
    const jsonStr = await db.exportAll();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const hojeStr = new Date().toISOString().split('T')[0];
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup-studio-leticia-${hojeStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.showToast('Backup baixado com sucesso!');
  }

  // Enviar resumo de backup para o próprio WhatsApp
  async sendBackupToWhatsApp() {
    const clientes = await db.getAll('clientes');
    const agendamentos = await db.getAll('agendamentos');
    const transacoes = await db.getAll('transacoes');

    let totalRecebido = 0;
    transacoes.filter(t => t.tipo === 'entrada').forEach(t => totalRecebido += parseFloat(t.valor) || 0);

    const hojeStr = new Date().toLocaleDateString('pt-BR');
    const texto = `*STUDIO LETÍCIA - RESUMO DE GESTÃO (${hojeStr})*\n\n` +
      `👥 Clientes Cadastradas: ${clientes.length}\n` +
      `🗓️ Total de Atendimentos: ${agendamentos.length}\n` +
      `💰 Total Entradas Registradas: ${this.formatCurrency(totalRecebido)}\n\n` +
      `✨ Todos os seus dados estão seguros no seu aparelho. Lembre-se de salvar o arquivo de backup regularmente!`;

    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(texto)}`, '_blank');
  }

  // Restaurar arquivo de backup
  async restoreBackup(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!confirm('ATENÇÃO: A restauração substituirá os dados atuais pelos dados do arquivo. Deseja continuar?')) {
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        await db.importAll(evt.target.result);
        this.showToast('Backup restaurado com sucesso! Recarregando...');
        setTimeout(() => window.location.reload(), 1200);
      } catch (err) {
        alert('Erro ao restaurar backup. Verifique se o arquivo é válido.');
        console.error(err);
      }
    };
    reader.readAsText(file);
  }

  // =========================================================================
  // SALVAR AGENDAMENTOS E CLIENTES
  // =========================================================================
  populateClientSelects() {
    const select = document.getElementById('app-client-select');
    if (!select) return;

    select.innerHTML = '<option value="">Selecione a cliente...</option>' + 
      this.allClients.map(c => `<option value="${c.id}">${c.nome}</option>`).join('');
  }

  populateServiceSelects() {
    const select = document.getElementById('app-service-select');
    if (!select) return;

    select.innerHTML = '<option value="">Selecione o serviço...</option>' + 
      this.allServices.map(s => `<option value="${s.id}">${s.nome} (${this.formatCurrency(s.preco)})</option>`).join('');
  }

  onAppointmentServiceChange() {
    const serviceId = document.getElementById('app-service-select').value;
    const servico = this.allServices.find(s => s.id === serviceId);
    const pacoteSelect = document.getElementById('app-package-select');
    const pacoteId = pacoteSelect ? pacoteSelect.value : null;

    if (servico) {
      if (pacoteId) {
        // Se um plano está ativo e selecionado, a sessão é coberta pelo plano (R$ 0,00)
        document.getElementById('app-price').value = '0.00';
      } else {
        document.getElementById('app-price').value = servico.preco;
      }
      document.getElementById('app-duration').value = servico.duracaoMin || 60;
    }
  }

  onAppointmentClientChange() {
    const clientId = document.getElementById('app-client-select').value;
    const client = this.allClients.find(c => c.id === clientId);
    const box = document.getElementById('app-package-option-box');
    const badge = document.getElementById('app-package-avail-badge');
    const select = document.getElementById('app-package-select');
    const itemBox = document.getElementById('app-package-item-box');
    const itemHint = document.getElementById('app-package-item-hint');

    if (client && client.pacotes && client.pacotes.length > 0) {
      // Filtra planos ativos que ainda tenham sessões disponíveis
      const activePackages = client.pacotes.filter(p => 
        p.status !== 'concluido' && (p.sessoesFeitas || 0) < (p.totalSessoes || 1)
      );

      if (activePackages.length > 0) {
        box.style.display = 'block';
        if (badge) {
          badge.style.display = 'inline-block';
          badge.textContent = activePackages.length === 1 ? '1 Plano Ativo' : `${activePackages.length} Planos Ativos`;
        }

        select.innerHTML = '<option value="">Não usar plano (Cobrar atendimento avulso)</option>' + 
          activePackages.map(p => {
            const restantes = (p.totalSessoes || 1) - (p.sessoesFeitas || 0);
            return `<option value="${p.id}">✨ ${p.servicoNome} (${restantes} de ${p.totalSessoes} restantes)</option>`;
          }).join('');

        // Se houver apenas 1 plano ativo, pré-seleciona para facilitar
        if (activePackages.length === 1) {
          select.value = activePackages[0].id;
        }

        this.onAppointmentPackageChange();
        return;
      }
    }

    // Cliente sem planos ativos
    box.style.display = 'none';
    if (badge) badge.style.display = 'none';
    if (itemBox) itemBox.style.display = 'none';
    if (itemHint) itemHint.textContent = '';
    select.innerHTML = '<option value="">Não usar plano (Cobrar avulso)</option>';
    select.value = '';
    this.onAppointmentServiceChange();
  }

  onAppointmentPackageChange() {
    const clientId = document.getElementById('app-client-select').value;
    const client = this.allClients.find(c => c.id === clientId);
    const pacoteSelect = document.getElementById('app-package-select');
    const pacoteId = pacoteSelect ? pacoteSelect.value : '';
    const itemBox = document.getElementById('app-package-item-box');
    const itemSelect = document.getElementById('app-package-item-select');
    const itemHint = document.getElementById('app-package-item-hint');

    if (!pacoteId || !client || !client.pacotes) {
      if (itemBox) itemBox.style.display = 'none';
      if (itemHint) itemHint.textContent = '';
      this.onAppointmentServiceChange();
      return;
    }

    const pacote = client.pacotes.find(p => p.id === pacoteId);
    if (!pacote) {
      if (itemBox) itemBox.style.display = 'none';
      return;
    }

    // Normaliza procedimentos do plano
    let itens = [];
    if (Array.isArray(pacote.itens) && pacote.itens.length > 0) {
      itens = pacote.itens;
    } else if (Array.isArray(pacote.servicosNomes) && pacote.servicosNomes.length > 0) {
      itens = pacote.servicosNomes.map(nome => ({
        nome,
        sessoes: Math.max(1, Math.floor((pacote.totalSessoes || 1) / pacote.servicosNomes.length)),
        feitas: 0
      }));
    } else {
      itens = [{
        nome: pacote.servicoNome || 'Procedimento do Plano',
        sessoes: pacote.totalSessoes || 1,
        feitas: pacote.sessoesFeitas || 0
      }];
    }

    if (itemSelect) {
      let optionsHtml = '';
      let firstAvailable = null;

      itens.forEach(item => {
        const disponiveis = Math.max(0, item.sessoes - (item.feitas || 0));
        const esgotado = disponiveis <= 0;
        if (!esgotado && !firstAvailable) {
          firstAvailable = item;
        }
        optionsHtml += `<option value="${this.escapeHtml(item.nome)}" ${esgotado ? 'disabled' : ''}>
          ${esgotado ? '❌' : '💆‍♀️'} ${item.nome} (${disponiveis} de ${item.sessoes} disponíveis)${esgotado ? ' - ESGOTADO' : ''}
        </option>`;
      });

      itemSelect.innerHTML = optionsHtml;
      if (firstAvailable) {
        itemSelect.value = firstAvailable.nome;
      }
    }

    if (itemBox) itemBox.style.display = 'block';
    this.onAppointmentPackageItemChange();
  }

  onAppointmentPackageItemChange() {
    const clientId = document.getElementById('app-client-select').value;
    const client = this.allClients.find(c => c.id === clientId);
    const pacoteId = document.getElementById('app-package-select').value;
    const itemSelect = document.getElementById('app-package-item-select');
    const itemHint = document.getElementById('app-package-item-hint');
    const priceInput = document.getElementById('app-price');
    const serviceSelect = document.getElementById('app-service-select');
    const durationInput = document.getElementById('app-duration');

    if (!pacoteId || !client || !client.pacotes || !itemSelect) return;

    const pacote = client.pacotes.find(p => p.id === pacoteId);
    if (!pacote) return;

    const selectedItemName = itemSelect.value;
    let item = (pacote.itens || []).find(i => i.nome === selectedItemName);
    if (!item) {
      item = { nome: selectedItemName || pacote.servicoNome, sessoes: pacote.totalSessoes, feitas: pacote.sessoesFeitas || 0 };
    }

    const disponiveis = Math.max(0, item.sessoes - (item.feitas || 0));
    const proximaSessao = Math.min(item.sessoes, (item.feitas || 0) + 1);

    if (itemHint) {
      if (disponiveis > 0) {
        itemHint.innerHTML = `✨ <strong>Sessão ${proximaSessao} de ${item.sessoes}</strong> deste procedimento (${disponiveis} disponível${disponiveis > 1 ? 'is' : ''} no plano).<br>O valor desta sessão será <strong>R$ 0,00</strong> porque já está quitada no plano.`;
        itemHint.style.color = '#2B6CB0';
        itemHint.style.background = '#EBF8FF';
      } else {
        itemHint.innerHTML = `⚠️ <strong>Atenção:</strong> Todas as ${item.sessoes} sessões deste procedimento já foram realizadas no plano!`;
        itemHint.style.color = '#C53030';
        itemHint.style.background = '#FFF5F5';
      }
    }

    // Zera o valor a ser cobrado
    if (priceInput) {
      priceInput.value = '0.00';
    }

    // Sincroniza o seletor de serviço do formulário com o item do plano
    if (serviceSelect && this.allServices) {
      const match = this.allServices.find(s => 
        s.nome.trim().toLowerCase() === selectedItemName.trim().toLowerCase() ||
        s.nome.toLowerCase().includes(selectedItemName.toLowerCase()) ||
        selectedItemName.toLowerCase().includes(s.nome.toLowerCase())
      );
      if (match) {
        serviceSelect.value = match.id;
        if (durationInput) {
          durationInput.value = match.duracaoMin || 60;
        }
      }
    }
  }

  openNewAppointmentModal(dataPadrao) {
    document.getElementById('form-appointment').reset();
    document.getElementById('app-id').value = '';
    document.getElementById('modal-appointment-title').textContent = 'Novo Agendamento';
    document.getElementById('app-date').value = dataPadrao || this.selectedAgendaDate;
    document.getElementById('app-time').value = '14:00';
    document.getElementById('app-package-option-box').style.display = 'none';
    const itemBox = document.getElementById('app-package-item-box');
    if (itemBox) itemBox.style.display = 'none';
    const itemHint = document.getElementById('app-package-item-hint');
    if (itemHint) itemHint.textContent = '';

    this.populateClientSelects();
    this.populateServiceSelects();
    this.openModal('modal-appointment');
  }

  openNewAppointmentForClient(clientId) {
    this.closeModal('modal-client-details');
    this.openNewAppointmentModal();
    document.getElementById('app-client-select').value = clientId;
    this.onAppointmentClientChange();
  }

  async saveAppointment(e) {
    if (e) e.preventDefault();
    try {
      const id = document.getElementById('app-id').value || ('agd_' + Date.now());
      const clienteId = document.getElementById('app-client-select').value;
      const servicoId = document.getElementById('app-service-select').value;
      const data = document.getElementById('app-date').value;
      const horario = document.getElementById('app-time').value;
      const valor = parseFloat(document.getElementById('app-price').value) || 0;
      const duracaoMin = parseInt(document.getElementById('app-duration').value, 10) || 60;
      const notas = document.getElementById('app-notes').value;
      const pacoteId = document.getElementById('app-package-select').value || null;

      if (!clienteId) {
        alert('Por favor, selecione a cliente para o agendamento.');
        return;
      }

      if (!servicoId) {
        alert('Por favor, selecione o serviço / procedimento.');
        return;
      }

      if (!data) {
        alert('Por favor, informe a data do atendimento.');
        return;
      }

      if (!horario) {
        alert('Por favor, informe o horário de início.');
        return;
      }

      // Validação rigorosa: Não permitir agendamentos com choque de horários na mesma data
      const conflict = await this.checkTimeConflict(data, horario, duracaoMin, id);
      if (conflict.hasConflict) {
        alert(`⚠️ Choque de Horários!\n\nJá existe um atendimento marcado para "${conflict.conflito.clienteNome}" (${conflict.conflito.servicoNome}) no intervalo de ${conflict.intervalo} do dia ${this.formatDate(data)}.\n\nPor favor, escolha outro horário ou dia para evitar conflitos na sua agenda.`);
        return;
      }

      const cliente = this.allClients.find(c => c.id === clienteId);
      const servico = this.allServices.find(s => s.id === servicoId);

      let numSessao = null;
      let pacoteNome = null;
      let pacoteItemNome = null;
      let totalSessoesPacote = null;

      if (pacoteId && cliente && cliente.pacotes) {
        const pacote = cliente.pacotes.find(p => p.id === pacoteId);
        if (pacote) {
          pacoteNome = pacote.servicoNome;
          const selectedItemName = document.getElementById('app-package-item-select') 
            ? document.getElementById('app-package-item-select').value 
            : null;

          let targetItem = null;
          if (Array.isArray(pacote.itens) && pacote.itens.length > 0) {
            targetItem = pacote.itens.find(i => i.nome === selectedItemName) || pacote.itens[0];
          }

          if (targetItem) {
            const disponiveis = targetItem.sessoes - (targetItem.feitas || 0);
            if (disponiveis <= 0) {
              alert(`⚠️ Atenção: Todas as sessões de "${targetItem.nome}" deste plano já foram concluídas!\nPor favor, escolha outro procedimento com saldo disponível.`);
              return;
            }
            pacoteItemNome = targetItem.nome;
            numSessao = (targetItem.feitas || 0) + 1;
            totalSessoesPacote = targetItem.sessoes;
          } else {
            if ((pacote.sessoesFeitas || 0) >= (pacote.totalSessoes || 1)) {
              alert(`⚠️ Atenção: Todas as sessões deste plano já foram concluídas!`);
              return;
            }
            pacoteItemNome = pacote.servicoNome;
            numSessao = (pacote.sessoesFeitas || 0) + 1;
            totalSessoesPacote = pacote.totalSessoes;
          }
        }
      }

      const agendamento = {
        id,
        clienteId,
        clienteNome: cliente ? cliente.nome : 'Cliente',
        whatsapp: cliente ? cliente.whatsapp : '',
        servicoId,
        servicoNome: pacoteItemNome || (servico ? servico.nome : 'Serviço'),
        data,
        horario,
        duracaoMin,
        valor: pacoteId ? 0 : valor,
        status: 'agendado',
        pago: pacoteId ? true : false,
        formaPagamento: pacoteId ? 'pacote' : null,
        pacoteId,
        pacoteNome,
        pacoteItemNome,
        numSessao,
        totalSessoesPacote,
        notas
      };

      await db.put('agendamentos', agendamento);

      // Bloqueia o horário no Supabase para as clientes não agendarem por cima
      try {
        const cloud = window.StudioCloud || (typeof StudioCloud !== 'undefined' ? StudioCloud : null);
        if (cloud && cloud.isConfigured()) {
          await cloud.blockSlotOnCloud(agendamento);
        }
      } catch (errCloud) {
        console.warn('Aviso: falha ao sincronizar slot com a nuvem:', errCloud);
      }

      this.closeModal('modal-appointment');
      this.showToast('Agendamento salvo com sucesso! ✨');

      this.selectedAgendaDate = data;
      await this.loadTodayTab();
      await this.renderCalendar();
      await this.updateSelectedDayPanel();
      if (this.currentTab === 'agenda') await this.loadAgendaTab();
    } catch (err) {
      console.error('Erro ao salvar agendamento:', err);
      alert('Erro ao salvar agendamento: ' + err.message);
    }
  }

  // Concluir Atendimento & Lançar no Caixa
  async openCompleteModal(appId) {
    const agendamento = await db.get('agendamentos', appId);
    if (!agendamento) return;

    this.activeAppointmentForCompletion = agendamento;
    document.getElementById('complete-app-id').value = agendamento.id;
    document.getElementById('complete-summary-client').textContent = agendamento.clienteNome;

    const descPacote = agendamento.pacoteItemNome 
      ? `${agendamento.pacoteItemNome} • Plano: ${agendamento.pacoteNome || 'Pacote'}${agendamento.numSessao ? ` (Sessão ${agendamento.numSessao})` : ''}`
      : agendamento.servicoNome;

    document.getElementById('complete-summary-service').textContent = 
      `${descPacote} • Agendado para ${agendamento.horario}`;
    document.getElementById('complete-supplies').value = agendamento.suprimentosGastos || '';
    document.getElementById('complete-evolution').value = agendamento.evolucaoSessao || '';
    document.getElementById('complete-payment-val').value = agendamento.valor || 0;

    if (agendamento.pacoteId) {
      document.getElementById('complete-payment-method').value = 'pacote';
      document.getElementById('complete-payment-val').value = '0.00';
    } else {
      document.getElementById('complete-payment-method').value = 'pix';
    }

    this.openModal('modal-complete-appointment');
  }

  async confirmCompletion(e) {
    if (e) e.preventDefault();
    if (!this.activeAppointmentForCompletion) return;

    try {
      const app = this.activeAppointmentForCompletion;
      const metodo = document.getElementById('complete-payment-method').value;
      const valorFinal = parseFloat(document.getElementById('complete-payment-val').value) || 0;
      const suprimentos = (document.getElementById('complete-supplies').value || '').trim();
      const evolucao = (document.getElementById('complete-evolution').value || '').trim();

      app.status = 'concluido';
      app.pago = true;
      app.formaPagamento = metodo;
      app.valor = valorFinal;
      app.suprimentosGastos = suprimentos;
      app.evolucaoSessao = evolucao;
      app.concluidoEm = new Date().toISOString();

      await db.put('agendamentos', app);

      // Se usou sessão de pacote, avança o contador do pacote
      if (app.pacoteId && app.clienteId) {
        const cliente = await db.get('clientes', app.clienteId);
        if (cliente && cliente.pacotes) {
          const pacote = cliente.pacotes.find(p => p.id === app.pacoteId);
          if (pacote) {
            // Avança contador total de sessões do pacote
            pacote.sessoesFeitas = Math.min(pacote.totalSessoes, (pacote.sessoesFeitas || 0) + 1);

            // Avança contador do procedimento específico do plano
            let procNome = app.pacoteItemNome || app.servicoNome;
            if (Array.isArray(pacote.itens) && pacote.itens.length > 0) {
              let matchedItem = pacote.itens.find(i => i.nome === procNome);
              if (!matchedItem) {
                matchedItem = pacote.itens.find(i => 
                  i.nome.toLowerCase() === (procNome || '').toLowerCase() ||
                  (i.id && i.id === app.servicoId) ||
                  (procNome && procNome.toLowerCase().includes((i.nome || '').toLowerCase())) ||
                  (i.nome && (procNome || '').toLowerCase().includes(i.nome.toLowerCase()))
                );
              }
              if (matchedItem) {
                matchedItem.feitas = Math.min(matchedItem.sessoes, (matchedItem.feitas || 0) + 1);
                procNome = matchedItem.nome;
              }
            }

            // Verifica se o pacote foi 100% finalizado
            const allItemsDone = Array.isArray(pacote.itens) && pacote.itens.length > 0
              ? pacote.itens.every(i => (i.feitas || 0) >= i.sessoes)
              : false;

            const planoFinalizado = pacote.sessoesFeitas >= pacote.totalSessoes || allItemsDone;
            if (planoFinalizado) {
              pacote.status = 'concluido';
              pacote.concluidoEm = new Date().toISOString();
            }

            await db.put('clientes', cliente);
            // Sincroniza cache em memória
            const cIdx = this.allClients.findIndex(c => c.id === cliente.id);
            if (cIdx !== -1) this.allClients[cIdx] = cliente;

            if (planoFinalizado) {
              this.showToast(`🎉 Parabéns! Todas as ${pacote.totalSessoes} sessões do plano foram concluídas!`);
            } else {
              this.showToast(`✓ Sessão de ${procNome} baixada do plano! (${pacote.sessoesFeitas} de ${pacote.totalSessoes} concluídas)`);
            }
          }
        }
      } else if (metodo === 'pacote' && app.clienteId) {
        // Modo inteligente: se marcou como "pacote" na finalização mas não havia vinculado antes
        const cliente = await db.get('clientes', app.clienteId);
        if (cliente && cliente.pacotes) {
          const activePkg = cliente.pacotes.find(p => 
            p.status !== 'concluido' && (p.sessoesFeitas || 0) < p.totalSessoes
          );
          if (activePkg) {
            app.pacoteId = activePkg.id;
            app.pacoteNome = activePkg.servicoNome;
            activePkg.sessoesFeitas = Math.min(activePkg.totalSessoes, (activePkg.sessoesFeitas || 0) + 1);
            if (Array.isArray(activePkg.itens) && activePkg.itens.length > 0) {
              const matchedItem = activePkg.itens.find(i => 
                (i.feitas || 0) < i.sessoes && (
                  i.nome === app.servicoNome || 
                  (i.id && i.id === app.servicoId) ||
                  app.servicoNome.toLowerCase().includes((i.nome || '').toLowerCase()) ||
                  i.nome.toLowerCase().includes((app.servicoNome || '').toLowerCase())
                )
              ) || activePkg.itens.find(i => (i.feitas || 0) < i.sessoes);
              if (matchedItem) {
                matchedItem.feitas = Math.min(matchedItem.sessoes, (matchedItem.feitas || 0) + 1);
                app.pacoteItemNome = matchedItem.nome;
              }
            }
            if (activePkg.sessoesFeitas >= activePkg.totalSessoes) {
              activePkg.status = 'concluido';
              activePkg.concluidoEm = new Date().toISOString();
            }
            await db.put('clientes', cliente);
            const cIdx = this.allClients.findIndex(c => c.id === cliente.id);
            if (cIdx !== -1) this.allClients[cIdx] = cliente;
            await db.put('agendamentos', app);
            this.showToast(`✓ Sessão baixada do plano "${activePkg.servicoNome}"! (${activePkg.sessoesFeitas}/${activePkg.totalSessoes})`);
          }
        }
      }

      // Registra no Caixa caso haja valor monetário
      if (valorFinal > 0 && metodo !== 'pacote') {
        await db.put('transacoes', {
          id: 'tx_' + Date.now(),
          tipo: 'entrada',
          descricao: `${app.servicoNome} - ${app.clienteNome}`,
          categoria: 'servico',
          valor: valorFinal,
          data: app.data,
          formaPagamento: metodo,
          agendamentoId: app.id,
          criadoEm: new Date().toISOString()
        });
      }

      this.closeModal('modal-complete-appointment');
      this.showToast('Atendimento encerrado e gravado no Histórico! 💰✨');
      await this.loadTodayTab();
      if (this.currentTab === 'agenda') await this.loadAgendaTab();
      if (this.currentTab === 'caixa') await this.loadCashFlowTab();
      if (this.currentTab === 'clientes') await this.loadClientsTab();
    } catch (err) {
      console.error('Erro ao concluir atendimento:', err);
      alert('Erro ao concluir atendimento: ' + err.message);
    }
  }

  async reopenAppointment(appId) {
    const agendamento = await db.get('agendamentos', appId);
    if (!agendamento) return;

    // Se este agendamento concluído era de um pacote, reverte 1 sessão
    if (agendamento.status === 'concluido' && agendamento.pacoteId && agendamento.clienteId) {
      const cliente = await db.get('clientes', agendamento.clienteId);
      if (cliente && cliente.pacotes) {
        const pacote = cliente.pacotes.find(p => p.id === agendamento.pacoteId);
        if (pacote) {
          pacote.sessoesFeitas = Math.max(0, (pacote.sessoesFeitas || 1) - 1);
          if (Array.isArray(pacote.itens) && pacote.itens.length > 0) {
            const targetNome = agendamento.pacoteItemNome || agendamento.servicoNome;
            let matchedItem = pacote.itens.find(i => i.nome === targetNome) ||
              pacote.itens.find(i => i.nome.toLowerCase() === (targetNome || '').toLowerCase());
            if (matchedItem) {
              matchedItem.feitas = Math.max(0, (matchedItem.feitas || 1) - 1);
            }
          }
          pacote.status = 'ativo';
          delete pacote.concluidoEm;
          await db.put('clientes', cliente);
          const cIdx = this.allClients.findIndex(c => c.id === cliente.id);
          if (cIdx !== -1) this.allClients[cIdx] = cliente;
        }
      }
    }

    agendamento.status = 'agendado';
    await db.put('agendamentos', agendamento);
    this.showToast('Agendamento reaberto.');
    await this.loadTodayTab();
    await this.renderCalendar();
    await this.updateSelectedDayPanel();
    if (this.currentTab === 'agenda') await this.loadAgendaTab();
  }

  async deleteAppointment(id) {
    if (confirm('Deseja excluir este agendamento?')) {
      const agendamento = await db.get('agendamentos', id);

      // Se era agendamento concluído de pacote, reverte a sessão do pacote
      if (agendamento && agendamento.status === 'concluido' && agendamento.pacoteId && agendamento.clienteId) {
        const cliente = await db.get('clientes', agendamento.clienteId);
        if (cliente && cliente.pacotes) {
          const pacote = cliente.pacotes.find(p => p.id === agendamento.pacoteId);
          if (pacote) {
            pacote.sessoesFeitas = Math.max(0, (pacote.sessoesFeitas || 1) - 1);
            if (Array.isArray(pacote.itens) && pacote.itens.length > 0) {
              const targetNome = agendamento.pacoteItemNome || agendamento.servicoNome;
              let matchedItem = pacote.itens.find(i => i.nome === targetNome) ||
                pacote.itens.find(i => i.nome.toLowerCase() === (targetNome || '').toLowerCase());
              if (matchedItem) {
                matchedItem.feitas = Math.max(0, (matchedItem.feitas || 1) - 1);
              }
            }
            pacote.status = 'ativo';
            delete pacote.concluidoEm;
            await db.put('clientes', cliente);
            const cIdx = this.allClients.findIndex(c => c.id === cliente.id);
            if (cIdx !== -1) this.allClients[cIdx] = cliente;
          }
        }
      }

      await db.delete('agendamentos', id);

      if (agendamento) {
        try {
          const cloud = window.StudioCloud || (typeof StudioCloud !== 'undefined' ? StudioCloud : null);
          if (cloud && cloud.isConfigured()) {
            await cloud.unblockSlotOnCloud(agendamento);
          }
        } catch (errCloud) {
          console.warn('Erro ao desbloquear horário na nuvem:', errCloud);
        }
      }

      this.showToast('Agendamento excluído.');
      await this.loadTodayTab();
      await this.renderCalendar();
      await this.updateSelectedDayPanel();
      if (this.currentTab === 'agenda') await this.loadAgendaTab();
    }
  }

  // Clientes
  openNewClientModal() {
    const form = document.getElementById('form-client');
    if (form) form.reset();
    document.getElementById('client-id').value = '';
    document.getElementById('modal-client-title').textContent = 'Cadastrar Cliente';
    document.getElementById('client-preferencia-sessao').value = 'Com música relaxante';
    const sheet = document.getElementById('modal-client')?.querySelector('.modal-sheet');
    if (sheet) sheet.scrollTop = 0;
    this.openModal('modal-client');
    setTimeout(() => {
      if (sheet) sheet.scrollTop = 0;
      const nameInput = document.getElementById('client-name');
      if (nameInput) nameInput.focus();
    }, 120);
  }

  async editClient(id) {
    const client = await db.get('clientes', id);
    if (!client) return;

    this.closeModal('modal-client-details');
    document.getElementById('client-id').value = client.id;
    document.getElementById('modal-client-title').textContent = 'Editar Cliente';
    document.getElementById('client-name').value = client.nome || '';
    document.getElementById('client-phone').value = this.formatPhone(client.whatsapp || '');
    if (document.getElementById('client-cpf')) {
      document.getElementById('client-cpf').value = this.formatCPF(client.cpf || '');
    }
    document.getElementById('client-birthdate').value = client.nascimento || '';
    document.getElementById('client-peso').value = client.peso || (client.anamnese ? client.anamnese.peso : '') || '';
    document.getElementById('client-preferencia-sessao').value = client.preferenciaSessao || 'Com música relaxante';
    document.getElementById('client-notes').value = client.notas || '';

    const an = client.anamnese || {};
    document.getElementById('anamnese-queixa').value = an.queixaPrincipal || '';
    document.getElementById('anamnese-cirurgia').value = an.cirurgiaRecente || '';
    document.getElementById('anamnese-alergias').value = an.alergias || '';
    document.getElementById('anamnese-restricoes').value = an.restricoes || '';

    const sheet = document.getElementById('modal-client')?.querySelector('.modal-sheet');
    if (sheet) sheet.scrollTop = 0;
    this.openModal('modal-client');
    setTimeout(() => {
      if (sheet) sheet.scrollTop = 0;
    }, 120);
  }

  async saveClient(e) {
    if (e) e.preventDefault();
    try {
      const id = document.getElementById('client-id').value || ('cli_' + Date.now());
      const nomeInput = document.getElementById('client-name');
      const phoneInput = document.getElementById('client-phone');
      const nome = (nomeInput?.value || '').trim();
      const whatsapp = (phoneInput?.value || '').trim();
      const rawCpf = (document.getElementById('client-cpf') ? document.getElementById('client-cpf').value : '').replace(/\D/g, '');
      const nascimento = document.getElementById('client-birthdate').value;
      const peso = document.getElementById('client-peso').value;
      const preferenciaSessao = document.getElementById('client-preferencia-sessao').value;
      const notas = document.getElementById('client-notes').value;
      const sheet = document.getElementById('modal-client')?.querySelector('.modal-sheet');

      const highlightField = (input, msg) => {
        if (sheet) {
          sheet.scrollTo({ top: 0, behavior: 'smooth' });
        }
        if (input) {
          input.focus();
          input.style.border = '2px solid #E53E3E';
          input.style.backgroundColor = 'rgba(229, 62, 62, 0.08)';
          setTimeout(() => {
            input.style.border = '';
            input.style.backgroundColor = '';
          }, 3500);
        }
        this.showToast(msg);
      };

      if (!nome) {
        highlightField(nomeInput, '⚠️ Por favor, informe o Nome Completo no início da ficha.');
        return;
      }

      if (!whatsapp) {
        highlightField(phoneInput, '⚠️ Por favor, informe o WhatsApp da cliente.');
        return;
      }

      if (rawCpf && rawCpf.length === 11 && !this.isValidCPF(rawCpf)) {
        highlightField(document.getElementById('client-cpf'), '⚠️ O CPF digitado não é válido. Verifique os números.');
        return;
      }

      let existingClient = null;
      try {
        existingClient = await db.get('clientes', id);
      } catch (err) {}
      
      const pacotes = existingClient && existingClient.pacotes ? existingClient.pacotes : [];

      const cliente = {
        id,
        nome,
        cpf: rawCpf,
        whatsapp: whatsapp.replace(/\D/g, ''),
        nascimento,
        peso,
        preferenciaSessao,
        notas,
        anamnese: {
          queixaPrincipal: document.getElementById('anamnese-queixa').value || '',
          cirurgiaRecente: document.getElementById('anamnese-cirurgia').value || '',
          alergias: document.getElementById('anamnese-alergias').value || '',
          restricoes: document.getElementById('anamnese-restricoes').value || '',
          peso
        },
        pacotes,
        criadoEm: existingClient ? existingClient.criadoEm : new Date().toISOString()
      };

      await db.put('clientes', cliente);
      this.closeModal('modal-client');
      document.getElementById('form-client').reset();
      this.showToast('Cliente salva com sucesso! 🌸');
      await this.loadInitialData();
      await this.loadClientsTab();
      await this.loadTodayTab();
    } catch (err) {
      console.error('Erro ao salvar cliente:', err);
      alert('Erro ao salvar cliente: ' + err.message);
    }
  }

  // Modais genéricos
  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('active');
      const sheet = modal.querySelector('.modal-sheet');
      if (sheet) {
        sheet.scrollTop = 0;
        requestAnimationFrame(() => {
          sheet.scrollTop = 0;
        });
      }
    }
  }

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
  }

  openNewExpenseModal() {
    document.getElementById('form-expense').reset();
    document.getElementById('expense-date').value = new Date().toISOString().split('T')[0];
    this.openModal('modal-expense');
  }

  openNewServiceModal() {
    const form = document.getElementById('form-service');
    if (form) form.reset();

    const title = document.getElementById('modal-service-title');
    if (title) title.textContent = 'Novo Procedimento';

    const srvId = document.getElementById('srv-id');
    if (srvId) srvId.value = '';

    const srvDuration = document.getElementById('srv-duration');
    if (srvDuration) srvDuration.value = '60';

    const srvVisible = document.getElementById('srv-visible-site');
    if (srvVisible) srvVisible.checked = true;

    const srvDesc = document.getElementById('srv-desc');
    if (srvDesc) srvDesc.value = '';

    const btnSubmit = document.getElementById('btn-save-service');
    if (btnSubmit) btnSubmit.textContent = 'Salvar Procedimento & Atualizar Site ✨';

    this.openModal('modal-service');
  }

  // Notificação Toast
  showToast(msg) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2600);
  }

  // Formatadores
  formatCurrency(val) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
  }

  formatDate(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  }

  formatPhone(phone) {
    if (!phone) return '';
    const clean = phone.replace(/\D/g, '');
    if (clean.length === 11) {
      return `(${clean.slice(0, 2)}) ${clean.slice(2, 7)}-${clean.slice(7)}`;
    }
    return phone;
  }

  maskPhone(input) {
    if (!input) return;
    let v = input.value.replace(/\D/g, '').slice(0, 11);
    if (v.length > 10) {
      v = v.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
    } else if (v.length > 6) {
      v = v.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
    } else if (v.length > 2) {
      v = v.replace(/(\d{2})(\d{0,5})/, '($1) $2');
    }
    input.value = v;
  }

  formatCPF(cpf) {
    if (!cpf) return '';
    const clean = String(cpf).replace(/\D/g, '').slice(0, 11);
    if (clean.length === 11) {
      return clean.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    }
    return cpf;
  }

  maskCPF(input) {
    if (!input) return;
    let v = input.value.replace(/\D/g, '').slice(0, 11);
    if (v.length > 9) {
      v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
    } else if (v.length > 6) {
      v = v.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
    } else if (v.length > 3) {
      v = v.replace(/(\d{3})(\d{1,3})/, '$1.$2');
    }
    input.value = v;
  }

  isValidCPF(cpf) {
    const clean = String(cpf || '').replace(/\D/g, '');
    if (clean.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(clean)) return false;
    let sum = 0, rest;
    for (let i = 1; i <= 9; i++) sum += parseInt(clean.substring(i - 1, i)) * (11 - i);
    rest = (sum * 10) % 11;
    if (rest === 10 || rest === 11) rest = 0;
    if (rest !== parseInt(clean.substring(9, 10))) return false;
    sum = 0;
    for (let i = 1; i <= 10; i++) sum += parseInt(clean.substring(i - 1, i)) * (12 - i);
    rest = (sum * 10) % 11;
    if (rest === 10 || rest === 11) rest = 0;
    if (rest !== parseInt(clean.substring(10, 11))) return false;
    return true;
  }

  playNotificationChime() {
    try {
      if ('vibrate' in navigator) {
        navigator.vibrate([250, 100, 250]);
      }
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const playTone = (freq, start, duration) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
        gain.gain.setValueAtTime(0, ctx.currentTime + start);
        gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + start + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + duration);
      };
      playTone(587.33, 0, 0.5);    // D5
      playTone(880.00, 0.12, 0.8);  // A5
      playTone(1174.66, 0.26, 1.0); // D6 (Tríade ascendente de alto destaque)
    } catch (e) {
      console.log('Audio chime info:', e);
    }
  }

  flashTabTitle(msg) {
    if (this._titleFlasher) clearInterval(this._titleFlasher);
    const originalTitle = document.title;
    let toggle = false;
    let count = 0;
    this._titleFlasher = setInterval(() => {
      document.title = toggle ? msg : originalTitle;
      toggle = !toggle;
      count++;
      if (count > 25) {
        clearInterval(this._titleFlasher);
        document.title = originalTitle;
      }
    }, 700);
    window.addEventListener('focus', () => {
      if (this._titleFlasher) {
        clearInterval(this._titleFlasher);
        document.title = originalTitle;
      }
    }, { once: true });
  }

  // =========================================================================
  // FLUXO PÚBLICO DE AGENDAMENTO DA CLIENTE (UNIFICADO NO MESMO LINK)
  // =========================================================================
  async initClientBooking() {
    this.selectedBookingServices = [];
    this.selectedBookingService = null;
    this.selectedBookingDate = null;
    this.selectedBookingTime = null;
    this.standardSlots = [
      '08:00', '09:00', '10:00', '11:00', 
      '13:30', '14:30', '15:30', '16:30', '17:30'
    ];
    this.workingDays = [1, 2, 3, 4, 5, 6];

    // Carrega horários e dias configurados pela Letícia
    await this.loadPublicScheduleConfig();

    this.setupClientPhoneMask();
    this.setupClientDateInput();
    this.setupServicesOutsideClick();

    const params = new URLSearchParams(window.location.search);
    const idFromUrl = params.get('id');

    if (idFromUrl) {
      this.showClientStatusView(idFromUrl);
    } else {
      this.loadClientBookingServices();
    }
  }

  async loadPublicScheduleConfig() {
    try {
      const cloud = window.StudioCloud || (typeof StudioCloud !== 'undefined' ? StudioCloud : null);
      if (cloud && cloud.getPublicScheduleConfig) {
        const conf = await cloud.getPublicScheduleConfig();
        if (conf && Array.isArray(conf.slots) && conf.slots.length > 0) {
          this.standardSlots = conf.slots;
        }
        if (conf && Array.isArray(conf.diasSemana)) {
          this.workingDays = conf.diasSemana;
        }
      }
    } catch (e) {
      console.warn('Erro ao carregar configuração de horários:', e);
    }
  }

  setupClientPhoneMask() {
    const input = document.getElementById('booking-client-whatsapp') || document.getElementById('client-phone');
    if (!input || input.dataset.hasMask) return;
    input.dataset.hasMask = 'true';
    input.addEventListener('input', (e) => {
      let v = e.target.value.replace(/\D/g, '').slice(0, 11);
      if (v.length > 10) {
        v = v.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
      } else if (v.length > 5) {
        v = v.replace(/^(\d{2})(\d{4})(\d{0,4})$/, '($1) $2-$3');
      } else if (v.length > 2) {
        v = v.replace(/^(\d{2})(\d{0,5})$/, '($1) $2');
      }
      e.target.value = v;
    });
  }

  setupClientDateInput() {
    const input = document.getElementById('booking-date');
    if (!input || input.dataset.hasInit) return;
    input.dataset.hasInit = 'true';

    const hoje = new Date().toISOString().split('T')[0];
    input.min = hoje;

    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);
    input.value = amanha.toISOString().split('T')[0];
    this.selectedBookingDate = input.value;

    input.addEventListener('change', (e) => {
      this.selectedBookingDate = e.target.value;
      this.renderClientBookingSlots();
    });
  }

  async loadClientBookingServices() {
    const container = document.getElementById('services-list-container');
    if (!container) return;

    let services = [];

    // 1. Sempre prioriza catálogo oficial configurado na Nuvem (Supabase)
    try {
      const cloud = window.StudioCloud || (typeof StudioCloud !== 'undefined' ? StudioCloud : null);
      if (cloud && cloud.getPublicServices) {
        services = await cloud.getPublicServices();
      }
    } catch (e) {
      console.warn('Erro ao obter serviços da nuvem:', e);
    }

    // 2. Se a nuvem estiver indisponível/offline, tenta carregar do IndexedDB local
    if (!services || services.length === 0) {
      try {
        if (typeof db !== 'undefined' && db.getAll) {
          const local = await db.getAll('servicos');
          if (local && local.length > 0) {
            services = local.filter(s => !s.isPacote && s.visivelNoSite !== false).map(s => ({
              id: s.id,
              nome: s.nome,
              duracaoMin: s.duracaoMin || 60,
              preco: s.preco || 0,
              descricao: s.descricao || s.categoria || 'Procedimento realizado por Letícia Gomes'
            }));
          }
        }
      } catch (e) {
        console.warn('Erro ao carregar serviços locais:', e);
      }
    }

    // 3. Fallback de segurança com os procedimentos oficiais da Letícia
    if (!services || services.length === 0) {
      services = [
        {
          id: 'srv_1',
          nome: 'Drenagem Linfática Corporal',
          categoria: 'Corporal',
          duracaoMin: 60,
          preco: 130.00,
          descricao: 'Redução de retenção de líquidos, desinchaço e ativação da circulação.'
        },
        {
          id: 'srv_2',
          nome: 'Drenagem Linfática Facial',
          categoria: 'Facial',
          duracaoMin: 40,
          preco: 90.00,
          descricao: 'Revitalização facial, redução de olheiras e bolsas, efeito lifting.'
        },
        {
          id: 'srv_3',
          nome: 'Drenagem Linfática Pós-Operatório',
          categoria: 'Corporal',
          duracaoMin: 60,
          preco: 160.00,
          descricao: 'Atendimento especializado para pós-cirúrgico com toque suave e prevenção de fibroses.'
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
    }

    this.clientPublicServices = (services || []).filter(s => !s.isPacote && s.visivelNoSite !== false);

    if (!Array.isArray(this.selectedBookingServices)) {
      this.selectedBookingServices = [];
    }

    // Renderiza o cabeçalho informativo + lista vertical com checkboxes + rodapé de conclusão
    container.innerHTML = `
      <div style="padding: 10px 14px; background: rgba(190, 122, 71, 0.08); border: 1px solid rgba(190, 122, 71, 0.16); border-radius: 10px; margin-bottom: 8px; font-size: 0.82rem; color: var(--primary); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px;">
        <span>✨ <strong>Selecione 1 ou mais procedimentos</strong> desejados:</span>
        <span id="selected-services-counter" style="background: var(--accent-gold); color: #FFFFFF; padding: 2px 10px; border-radius: 12px; font-weight: 700; font-size: 0.76rem;">
          ${this.selectedBookingServices.length} selecionado(s)
        </span>
      </div>

      <div class="services-items-list" style="display: flex; flex-direction: column; gap: 8px; max-height: 380px; overflow-y: auto; padding-right: 2px;">
        ${services.map(s => {
          const isSelected = this.selectedBookingServices.some(sel => sel.id === s.id);
          return `
            <div class="service-option ${isSelected ? 'selected' : ''}" onclick="app.toggleClientBookingService('${s.id}', this)" data-service-id="${s.id}">
              <div class="service-left">
                <span class="service-checkbox ${isSelected ? 'active' : ''}"></span>
                <div class="service-info">
                  <div class="service-name-row">
                    <span class="service-name">${this.escapeHtml(s.nome)}</span>
                    <span class="service-badge">⏱️ ${s.duracaoMin || 60} min</span>
                  </div>
                  <div class="service-desc">${this.escapeHtml(s.descricao || 'Atendimento personalizado Letícia Gomes')}</div>
                </div>
              </div>
              <div class="service-right">
                <div class="service-price">${this.formatCurrency(s.preco)}</div>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <div id="services-dropdown-footer" style="position: sticky; bottom: 0; background: #FFFFFF; padding: 10px 8px 4px 8px; border-top: 1px solid var(--border-light); margin-top: 8px; display: flex; gap: 10px; align-items: center; justify-content: space-between; flex-wrap: wrap;">
        <div id="services-footer-summary" style="font-size: 0.82rem; color: var(--primary);">
          ${this.getServicesSummaryText()}
        </div>
        <button type="button" class="btn-complete" style="padding: 8px 16px; font-size: 0.82rem; border-radius: 20px; box-shadow: 0 2px 8px rgba(77, 38, 18, 0.15);" onclick="app.closeClientServicesList(event)">
          ✓ Concluir Seleção ⮝
        </button>
      </div>
    `;

    this.updateServicesDisplay();
    this.renderClientBookingSlots();
  }

  getServicesSummaryText() {
    const list = this.selectedBookingServices || [];
    const count = list.length;
    if (count === 0) return '<span style="color: var(--text-muted);">Nenhum procedimento selecionado</span>';
    const totalMin = list.reduce((acc, s) => acc + (parseInt(s.duracaoMin, 10) || 60), 0);
    const totalPreco = list.reduce((acc, s) => acc + (parseFloat(s.preco) || 0), 0);
    return `<strong>${count}</strong> proced. • ⏱️ <strong>${totalMin} min</strong> • 💰 <strong>${this.formatCurrency(totalPreco)}</strong>`;
  }

  updateServicesDisplay() {
    const display = document.getElementById('service-selected-display');
    const counterBadge = document.getElementById('selected-services-counter');
    const footerSummary = document.getElementById('services-footer-summary');

    const list = this.selectedBookingServices || [];
    const count = list.length;

    if (counterBadge) {
      counterBadge.textContent = `${count} selecionado(s)`;
      counterBadge.style.background = count > 0 ? 'var(--accent-gold)' : '#A39284';
    }

    if (footerSummary) {
      footerSummary.innerHTML = this.getServicesSummaryText();
    }

    if (!display) return;

    if (count === 0) {
      display.innerHTML = `
        <div style="font-size: 0.95rem; font-weight: 700; color: var(--primary);">💆‍♀️ Toque para escolher o(s) procedimento(s)...</div>
        <div style="font-size: 0.8rem; color: var(--text-muted);">Veja os procedimentos cadastrados e escolha 1 ou mais</div>
      `;
      return;
    }

    const totalMin = list.reduce((acc, s) => acc + (parseInt(s.duracaoMin, 10) || 60), 0);
    const totalPreco = list.reduce((acc, s) => acc + (parseFloat(s.preco) || 0), 0);

    if (count === 1) {
      const s = list[0];
      display.innerHTML = `
        <div style="display: flex; flex-direction: column;">
          <div style="font-size: 1.05rem; font-weight: 800; color: var(--primary);">
            ✨ ${this.escapeHtml(s.nome)}
          </div>
          <div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 3px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span style="background: rgba(190, 122, 71, 0.12); color: var(--accent-gold); padding: 2px 7px; border-radius: 6px; font-weight: 700; font-size: 0.75rem;">⏱️ ${s.duracaoMin || 60} min</span>
            <span style="font-weight: 800; color: var(--primary); font-size: 0.95rem;">${this.formatCurrency(s.preco)}</span>
            <span style="color: var(--accent-gold); font-size: 0.76rem; font-weight: 600;">• (1 selecionado — toque para alterar ou adicionar mais)</span>
          </div>
        </div>
      `;
    } else {
      const nomes = list.map(s => this.escapeHtml(s.nome)).join(' + ');
      display.innerHTML = `
        <div style="display: flex; flex-direction: column;">
          <div style="font-size: 1.02rem; font-weight: 800; color: var(--primary); display: flex; align-items: center; gap: 6px;">
            <span>✨</span> <strong>${count} procedimentos selecionados:</strong>
          </div>
          <div style="font-size: 0.85rem; color: var(--accent-bronze); font-weight: 700; margin-top: 2px; line-height: 1.35;">
            ${nomes}
          </div>
          <div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 4px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span style="background: rgba(190, 122, 71, 0.15); color: var(--primary); padding: 2px 8px; border-radius: 6px; font-weight: 800; font-size: 0.76rem;">⏱️ Tempo Total: ${totalMin} min</span>
            <span style="font-weight: 800; color: var(--primary); font-size: 0.95rem;">💰 Total: ${this.formatCurrency(totalPreco)}</span>
            <span style="color: var(--accent-gold); font-size: 0.76rem; font-weight: 600;">• Toque para alterar</span>
          </div>
        </div>
      `;
    }
  }

  toggleClientServicesList() {
    const list = document.getElementById('services-list-container');
    const chevron = document.getElementById('service-chevron');
    const trigger = document.getElementById('service-select-trigger');
    if (!list) return;
    const isHidden = list.style.display === 'none' || !list.style.display;
    list.style.display = isHidden ? 'flex' : 'none';
    if (chevron) {
      chevron.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
    }
    if (trigger) {
      if (isHidden) trigger.classList.add('open');
      else trigger.classList.remove('open');
    }
    if (isHidden) list.classList.add('open');
    else list.classList.remove('open');
  }

  openClientServicesList() {
    const list = document.getElementById('services-list-container');
    const chevron = document.getElementById('service-chevron');
    const trigger = document.getElementById('service-select-trigger');
    if (!list) return;
    list.style.display = 'flex';
    list.classList.add('open');
    if (chevron) chevron.style.transform = 'rotate(180deg)';
    if (trigger) trigger.classList.add('open');
  }

  closeClientServicesList(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    const list = document.getElementById('services-list-container');
    const chevron = document.getElementById('service-chevron');
    const trigger = document.getElementById('service-select-trigger');
    if (list) {
      list.style.display = 'none';
      list.classList.remove('open');
    }
    if (chevron) chevron.style.transform = 'rotate(0deg)';
    if (trigger) trigger.classList.remove('open');
  }

  toggleClientBookingService(id, el) {
    const service = (this.clientPublicServices || []).find(s => s.id === id);
    if (!service) return;

    if (!Array.isArray(this.selectedBookingServices)) {
      this.selectedBookingServices = [];
    }

    const idx = this.selectedBookingServices.findIndex(s => s.id === id);
    const itemEl = el || document.querySelector(`[data-service-id="${id}"]`);

    if (idx >= 0) {
      this.selectedBookingServices.splice(idx, 1);
      if (itemEl) {
        itemEl.classList.remove('selected');
        const box = itemEl.querySelector('.service-checkbox, .service-radio');
        if (box) box.classList.remove('active');
      }
    } else {
      this.selectedBookingServices.push(service);
      if (itemEl) {
        itemEl.classList.add('selected');
        const box = itemEl.querySelector('.service-checkbox, .service-radio');
        if (box) box.classList.add('active');
      }
    }

    this.selectedBookingService = this.selectedBookingServices[0] || null;
    this.updateServicesDisplay();
    this.renderClientBookingSlots();
  }

  selectClientBookingService(id, el) {
    this.toggleClientBookingService(id, el);
  }

  setupServicesOutsideClick() {
    if (this._hasServicesOutsideClick) return;
    this._hasServicesOutsideClick = true;
    document.addEventListener('click', (e) => {
      const card = document.getElementById('service-select-trigger')?.closest('.booking-step-card');
      const list = document.getElementById('services-list-container');
      if (card && list && list.style.display !== 'none' && !card.contains(e.target)) {
        this.closeClientServicesList();
      }
    });
  }

  async syncServicesToCloud(showToastFeedback = false) {
    const cloud = window.StudioCloud || (typeof StudioCloud !== 'undefined' ? StudioCloud : null);
    if (!cloud || !cloud.isConfigured()) return;
    try {
      const servicos = await db.getAll('servicos');
      const toSync = (servicos || []).filter(s => !s.isPacote).map(s => ({
        id: s.id,
        nome: s.nome,
        categoria: s.categoria || 'Corporal',
        duracaoMin: s.duracaoMin || 60,
        preco: Number(s.preco) || 0,
        descricao: s.descricao || '',
        visivelNoSite: s.visivelNoSite !== false
      }));

      await cloud.syncServicesCatalog(toSync);
      if (showToastFeedback) {
        this.showToast('✅ Catálogo atualizado no site com sucesso!');
      }
    } catch (e) {
      console.warn('Aviso: falha ao sincronizar catálogo na nuvem:', e);
      if (showToastFeedback) {
        this.showToast('⚠️ Falha ao sincronizar catálogo no site. Verifique a conexão.');
      }
    }
  }

  async syncAppointmentsToCloud() {
    const cloud = window.StudioCloud || (typeof StudioCloud !== 'undefined' ? StudioCloud : null);
    if (!cloud || !cloud.isConfigured()) return;
    try {
      const agendamentos = await db.getAll('agendamentos');
      if (agendamentos && agendamentos.length > 0) {
        await cloud.syncLocalAppointmentsToCloud(agendamentos);
      }
    } catch (e) {
      console.warn('Aviso: falha ao sincronizar agendamentos na nuvem:', e);
    }
  }

  // =========================================================================
  // GESTÃO DE HORÁRIOS & DIAS DE ATENDIMENTO (LETÍCIA)
  // =========================================================================
  async openScheduleConfigModal() {
    const cloud = window.StudioCloud || (typeof StudioCloud !== 'undefined' ? StudioCloud : null);
    let conf = {
      slots: ['08:00', '09:00', '10:00', '11:00', '13:30', '14:30', '15:30', '16:30', '17:30'],
      diasSemana: [1, 2, 3, 4, 5, 6]
    };
    if (cloud && cloud.getPublicScheduleConfig) {
      conf = await cloud.getPublicScheduleConfig();
    }

    this.tempScheduleSlots = [...(conf.slots || this.standardSlots || ['08:00', '09:00', '10:00', '11:00', '13:30', '14:30', '15:30', '16:30', '17:30'])];
    this.tempWorkingDays = [...(conf.diasSemana || this.workingDays || [1, 2, 3, 4, 5, 6])];

    this.renderScheduleDays();
    this.renderScheduleChips();
    this.openModal('modal-schedule-config');
  }

  renderScheduleDays() {
    const container = document.getElementById('schedule-days-container');
    if (!container) return;

    const dias = [
      { id: 1, label: 'Segunda' },
      { id: 2, label: 'Terça' },
      { id: 3, label: 'Quarta' },
      { id: 4, label: 'Quinta' },
      { id: 5, label: 'Sexta' },
      { id: 6, label: 'Sábado' },
      { id: 0, label: 'Domingo' }
    ];

    container.innerHTML = dias.map(d => {
      const isActive = this.tempWorkingDays.includes(d.id);
      return `
        <label style="display: flex; align-items: center; gap: 8px; background: ${isActive ? 'var(--bg-card-tint)' : '#FFFFFF'}; border: 1.5px solid ${isActive ? 'var(--accent-gold)' : 'var(--border-color)'}; padding: 8px 10px; border-radius: 8px; font-size: 0.82rem; font-weight: 600; cursor: pointer; transition: all 0.2s ease;">
          <input type="checkbox" ${isActive ? 'checked' : ''} onchange="app.toggleScheduleDay(${d.id}, this.checked)" style="accent-color: var(--accent-gold); width: 16px; height: 16px;">
          <span style="color: ${isActive ? 'var(--primary)' : 'var(--text-muted)'};">${d.label}</span>
        </label>
      `;
    }).join('');
  }

  toggleScheduleDay(dayId, isChecked) {
    if (isChecked) {
      if (!this.tempWorkingDays.includes(dayId)) this.tempWorkingDays.push(dayId);
    } else {
      this.tempWorkingDays = this.tempWorkingDays.filter(id => id !== dayId);
    }
    this.renderScheduleDays();
  }

  renderScheduleChips() {
    const container = document.getElementById('schedule-slots-chips');
    if (!container) return;

    this.tempScheduleSlots.sort();

    if (this.tempScheduleSlots.length === 0) {
      container.innerHTML = `
        <div style="width: 100%; text-align: center; color: var(--danger); font-size: 0.82rem; padding: 10px;">
          Nenhum horário cadastrado! Adicione horários abaixo.
        </div>
      `;
      return;
    }

    container.innerHTML = this.tempScheduleSlots.map(time => `
      <div style="display: inline-flex; align-items: center; gap: 8px; background: #FFFFFF; border: 1.5px solid var(--accent-gold); color: var(--primary); font-weight: 700; padding: 6px 12px; border-radius: 20px; font-size: 0.88rem; box-shadow: var(--shadow-sm);">
        <span>${time}</span>
        <button type="button" style="background: none; border: none; color: #E53E3E; cursor: pointer; font-size: 1rem; font-weight: bold; line-height: 1; padding: 0 2px;" onclick="app.removeScheduleSlot('${time}')" title="Remover horário do site">✕</button>
      </div>
    `).join('');
  }

  addNewScheduleSlot() {
    const input = document.getElementById('new-slot-time-input');
    if (!input || !input.value) {
      alert('Por favor, selecione ou digite o horário que deseja adicionar.');
      return;
    }
    const val = input.value.trim();
    if (this.tempScheduleSlots.includes(val)) {
      alert(`O horário ${val} já está cadastrado na grade!`);
      return;
    }
    this.tempScheduleSlots.push(val);
    this.tempScheduleSlots.sort();
    this.renderScheduleChips();
    input.value = '';
    this.showToast(`Horário ${val} adicionado! Clique em Salvar para publicar.`);
  }

  removeScheduleSlot(time) {
    this.tempScheduleSlots = this.tempScheduleSlots.filter(t => t !== time);
    this.renderScheduleChips();
  }

  resetDefaultSlots() {
    if (confirm('Deseja restaurar a grade para os horários padrão (08:00 às 17:30 de Segunda a Sábado)?')) {
      this.tempScheduleSlots = ['08:00', '09:00', '10:00', '11:00', '13:30', '14:30', '15:30', '16:30', '17:30'];
      this.tempWorkingDays = [1, 2, 3, 4, 5, 6];
      this.renderScheduleDays();
      this.renderScheduleChips();
      this.showToast('Grade padrão restaurada na tela. Clique em Salvar para confirmar.');
    }
  }

  async saveScheduleConfig() {
    if (!this.tempScheduleSlots || this.tempScheduleSlots.length === 0) {
      alert('A grade precisa ter pelo menos 1 horário disponível.');
      return;
    }

    if (!this.tempWorkingDays || this.tempWorkingDays.length === 0) {
      alert('Selecione pelo menos 1 dia da semana em que o Studio atende.');
      return;
    }

    this.standardSlots = [...this.tempScheduleSlots].sort();
    this.workingDays = [...this.tempWorkingDays];

    const config = {
      slots: this.standardSlots,
      diasSemana: this.workingDays
    };

    try {
      const cloud = window.StudioCloud || (typeof StudioCloud !== 'undefined' ? StudioCloud : null);
      if (cloud && cloud.syncScheduleConfig) {
        await cloud.syncScheduleConfig(config);
      }
    } catch (e) {
      console.warn('Erro ao sincronizar horários:', e);
    }

    this.closeModal('modal-schedule-config');
    this.showToast('Grade de horários salva e sincronizada com sucesso! 🕒✨');

    if (this.selectedBookingDate) {
      this.renderClientBookingSlots();
    }
  }

  async renderClientBookingSlots() {
    const container = document.getElementById('time-slots-container');
    if (!container || !this.selectedBookingDate) return;

    // 1. Verifica se a data selecionada cai em um dia de atendimento ativo
    if (this.selectedBookingDate) {
      const [ano, mes, dia] = this.selectedBookingDate.split('-').map(Number);
      const dateObj = new Date(ano, mes - 1, dia);
      const dayOfWeek = dateObj.getDay(); // 0=Dom, 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex, 6=Sáb
      const allowedDays = Array.isArray(this.workingDays) && this.workingDays.length > 0 ? this.workingDays : [1, 2, 3, 4, 5, 6];

      if (!allowedDays.includes(dayOfWeek)) {
        container.innerHTML = `
          <div style="grid-column: 1 / -1; background: #FFF4E5; border: 1.5px solid #FFE2B8; border-radius: 8px; padding: 14px 16px; text-align: center; color: #925D11; font-size: 0.88rem;">
            🚫 <strong>Studio Fechado nesta data</strong><br>
            <span style="font-size: 0.8rem; color: #7B4B0C; margin-top: 4px; display: inline-block;">
              A Letícia não realiza atendimentos neste dia da semana. Por favor, escolha outra data acima.
            </span>
          </div>
        `;
        return;
      }
    }

    let busySlots = [];
    try {
      const cloud = window.StudioCloud || (typeof StudioCloud !== 'undefined' ? StudioCloud : null);
      if (cloud && cloud.getBusySlotsForDate) {
        busySlots = await cloud.getBusySlotsForDate(this.selectedBookingDate);
      }
    } catch (e) {
      console.warn('Erro ao consultar horários ocupados:', e);
    }

    const slots = (this.standardSlots && this.standardSlots.length > 0) ? this.standardSlots : [
      '08:00', '09:00', '10:00', '11:00', 
      '13:30', '14:30', '15:30', '16:30', '17:30'
    ];

    if (slots.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 14px; font-size: 0.85rem;">
          Nenhum horário disponível para agendamento online nesta data.
        </div>
      `;
      return;
    }

    container.innerHTML = slots.map(time => {
      const isBusy = Array.isArray(busySlots) && busySlots.includes(time);
      const isSelected = this.selectedBookingTime === time;

      return `
        <button type="button" class="time-slot-btn ${isBusy ? 'disabled' : ''} ${isSelected ? 'selected' : ''}" 
          ${isBusy ? 'disabled' : ''} 
          onclick="app.selectClientBookingTime('${time}', this)">
          ${time}
        </button>
      `;
    }).join('');
  }

  selectClientBookingTime(time, btn) {
    this.selectedBookingTime = time;
    document.querySelectorAll('.time-slot-btn').forEach(b => b.classList.remove('selected'));
    if (btn) btn.classList.add('selected');
  }

  async submitClientBookingRequest() {
    const btn = document.getElementById('btn-submit');
    const nomeInput = document.getElementById('booking-client-name') || document.getElementById('client-name');
    const wppInput = document.getElementById('booking-client-whatsapp') || document.getElementById('client-whatsapp');
    const cpfInput = document.getElementById('booking-client-cpf') || document.getElementById('client-cpf');
    const notesInput = document.getElementById('booking-client-notes') || document.getElementById('client-notes');

    const nome = (nomeInput ? nomeInput.value : '').trim();
    const wpp = (wppInput ? wppInput.value : '').replace(/\D/g, '');
    const cpf = (cpfInput ? cpfInput.value : '').replace(/\D/g, '');
    const notes = (notesInput ? notesInput.value : '').trim();

    if (!this.selectedBookingServices || this.selectedBookingServices.length === 0) {
      alert('Por favor, selecione ao menos um procedimento que deseja realizar.');
      this.openClientServicesList();
      return;
    }

    if (!this.selectedBookingDate) {
      alert('Por favor, selecione a data do agendamento.');
      return;
    }

    if (!this.selectedBookingTime) {
      alert('Por favor, selecione um dos horários disponíveis.');
      return;
    }

    if (!nome) {
      alert('Por favor, digite seu nome completo.');
      if (nomeInput) nomeInput.focus();
      return;
    }

    if (wpp.length < 10) {
      alert('Por favor, informe seu WhatsApp com DDD.');
      if (wppInput) wppInput.focus();
      return;
    }

    if (!cpf || cpf.length !== 11) {
      alert('Por favor, informe seu CPF completo (11 dígitos).');
      if (cpfInput) cpfInput.focus();
      return;
    }

    if (!this.isValidCPF(cpf)) {
      alert('O CPF digitado não é válido. Por favor, confira os números.');
      if (cpfInput) cpfInput.focus();
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Enviando solicitação... ⏳';
    }

    try {
      const totalPreco = this.selectedBookingServices.reduce((acc, s) => acc + (Number(s.preco) || 0), 0);
      const totalMin = this.selectedBookingServices.reduce((acc, s) => acc + (parseInt(s.duracaoMin, 10) || 60), 0);
      const nomesConcatenados = this.selectedBookingServices.map(s => s.nome).join(' + ');
      const idsConcatenados = this.selectedBookingServices.map(s => s.id).join(', ');

      const detalheServicos = this.selectedBookingServices.map((s, idx) => 
        `${idx + 1}. ${s.nome} (${s.duracaoMin || 60}min - ${this.formatCurrency(s.preco)})`
      ).join(' | ');

      const obsCompleta = notes ? `${notes} [Procedimentos: ${detalheServicos}]` : `[Procedimentos: ${detalheServicos}]`;

      const requestData = {
        cliente_nome: nome,
        cliente_whatsapp: wpp,
        cliente_cpf: cpf,
        servico_id: idsConcatenados,
        servico_nome: nomesConcatenados,
        servico_preco: totalPreco,
        duracao_min: totalMin,
        data: this.selectedBookingDate,
        horario: this.selectedBookingTime,
        observacoes: obsCompleta,
        status: 'pendente'
      };

      const cloud = window.StudioCloud || (typeof StudioCloud !== 'undefined' ? StudioCloud : null);
      if (!cloud) {
        throw new Error('Serviço de agendamento online não disponível.');
      }
      const result = await cloud.createBookingRequest(requestData);

      if (result && result.id) {
        const fullBookingData = {
          ...requestData,
          ...result,
          id: result.id
        };
        try {
          localStorage.setItem(`studio_booking_${result.id}`, JSON.stringify(fullBookingData));
        } catch (_) {}

        const newUrl = `${window.location.pathname}?id=${result.id}`;
        window.history.pushState({ path: newUrl }, '', newUrl);
        this.showClientStatusView(result.id, fullBookingData);

        // Oferece aviso instantâneo pelo WhatsApp para aprovação mais rápida
        setTimeout(async () => {
          try {
            const config = (await db.get('config', 'app_config')) || {};
            let studioNum = (config.whatsappStudio || config.studioPhone || '6493094775').replace(/\D/g, '');
            if (!studioNum.startsWith('55')) studioNum = '55' + studioNum;

            const [ano, mes, dia] = (fullBookingData.data || '').split('-');
            const dataFmt = dia && mes ? `${dia}/${mes}/${ano}` : fullBookingData.data;
            const msgWpp = encodeURIComponent(
              `Olá, Letícia! Acabei de fazer um pré-agendamento pelo seu site:\n\n` +
              `👤 *Cliente:* ${fullBookingData.cliente_nome}\n` +
              `💆‍♀️ *Procedimento:* ${fullBookingData.servico_nome}\n` +
              `🗓️ *Data:* ${dataFmt} às ${fullBookingData.horario}\n` +
              `💰 *Valor:* R$ ${Number(fullBookingData.servico_preco || 0).toFixed(2).replace('.', ',')}\n\n` +
              `Pode confirmar na sua agenda para mim, por favor? ✨`
            );

            if (confirm('✨ Pré-agendamento registrado com sucesso!\n\nDeseja abrir o WhatsApp da Letícia agora para avisá-la e agilizar a confirmação do seu horário?')) {
              window.open(`https://wa.me/${studioNum}?text=${msgWpp}`, '_blank');
            }
          } catch (_) {}
        }, 400);
      } else {
        alert('Não foi possível enviar o agendamento. Verifique sua conexão e tente novamente.');
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Solicitar Agendamento com a Letícia ✨';
        }
      }
    } catch (err) {
      console.error(err);
      alert('Ocorreu um erro ao enviar sua solicitação. Tente novamente em instantes.');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Solicitar Agendamento com a Letícia ✨';
      }
    }
  }

  async showClientStatusView(requestId, initialData = null) {
    const formSection = document.getElementById('section-booking-form');
    const statusSection = document.getElementById('section-status-view');
    if (formSection) formSection.style.display = 'none';
    if (statusSection) statusSection.style.display = 'block';

    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Renderiza imediatamente com dados iniciais se disponíveis
    await this.updateClientStatusScreen(requestId, initialData);

    // Conecta Realtime para atualizar status no milissegundo em que a Letícia aprova
    const cloud = window.StudioCloud || (typeof StudioCloud !== 'undefined' ? StudioCloud : null);
    if (cloud && cloud.subscribeToBookingStatus) {
      if (this.clientStatusRealtime) cloud.unsubscribe(this.clientStatusRealtime);
      this.clientStatusRealtime = cloud.subscribeToBookingStatus(requestId, (updated) => {
        this.updateClientStatusScreen(requestId, updated);
      });
    }

    if (this.clientStatusPoller) clearInterval(this.clientStatusPoller);
    this.clientStatusPoller = setInterval(() => this.updateClientStatusScreen(requestId), 5000);
  }

  async updateClientStatusScreen(requestId, providedData = null) {
    const cloud = window.StudioCloud || (typeof StudioCloud !== 'undefined' ? StudioCloud : null);

    let data = providedData;
    if (!data && cloud && cloud.getBookingRequestById) {
      data = await cloud.getBookingRequestById(requestId);
    }
    if (!data) {
      try {
        const cached = localStorage.getItem('studio_booking_' + requestId);
        if (cached) data = JSON.parse(cached);
      } catch (_) {}
    }

    if (Array.isArray(data)) data = data[0];
    if (data && data.data && typeof data.data === 'object' && !data.cliente_nome) data = data.data;
    if (!data) return;

    const card = document.getElementById('status-card-element');
    const icon = document.getElementById('status-icon');
    const badge = document.getElementById('status-badge');
    const headline = document.getElementById('status-headline');
    const desc = document.getElementById('status-desc');
    const details = document.getElementById('status-details');
    const btnWpp = document.getElementById('btn-talk-leticia');

    const clienteNome = data.cliente_nome || data.clienteNome || 'Cliente';
    const servicoNome = data.servico_nome || data.servicoNome || 'Procedimento';
    const rawData = data.data || data.dataAgendamento || '';
    const horario = data.horario || data.hora || '';
    const preco = Number(data.servico_preco !== undefined ? data.servico_preco : (data.valor || 0));
    const status = data.status || 'pendente';

    let dataFormatada = rawData;
    if (rawData && rawData.includes('-')) {
      const parts = rawData.split('-');
      if (parts.length === 3) dataFormatada = `${parts[2]}/${parts[1]}/${parts[0]}`;
    }

    if (details) {
      details.innerHTML = `
        <div class="details-row">
          <span class="details-label">Cliente:</span>
          <span class="details-value">${this.escapeHtml(clienteNome)}</span>
        </div>
        <div class="details-row">
          <span class="details-label">Procedimento:</span>
          <span class="details-value">${this.escapeHtml(servicoNome)}</span>
        </div>
        <div class="details-row">
          <span class="details-label">Data Solicitada:</span>
          <span class="details-value">${dataFormatada}${horario ? ` às ${horario}` : ''}</span>
        </div>
        <div class="details-row">
          <span class="details-label">Valor:</span>
          <span class="details-value">R$ ${preco.toFixed(2).replace('.', ',')}</span>
        </div>
        <div class="details-row" style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--border-color); display: flex; flex-direction: column; align-items: flex-start; gap: 4px;">
          <div style="display: flex; align-items: center; gap: 6px; font-weight: 700; color: var(--primary); font-size: 0.86rem;">
            <span>📍</span> Endereço do Studio:
          </div>
          <div style="font-size: 0.82rem; color: var(--text-main);">
            Rua 26, número 135 • Colmeia Park • Jataí - GO
          </div>
          <a href="https://maps.google.com/?q=-17.858556,-51.716417" target="_blank" rel="noopener noreferrer" style="display: inline-flex; align-items: center; gap: 6px; background: rgba(190, 122, 71, 0.12); color: var(--primary); border: 1px solid var(--accent-gold); padding: 6px 12px; border-radius: 20px; font-size: 0.78rem; font-weight: 700; text-decoration: none; margin-top: 4px;">
            <span>🗺️</span> Abrir no Google Maps
          </a>
        </div>
      `;
    }

    const config = (await db.get('config', 'app_config')) || {};
    let studioNum = (config.whatsappStudio || config.studioPhone || '6493094775').replace(/\D/g, '');
    if (!studioNum.startsWith('55')) studioNum = '55' + studioNum;

    if (card) card.className = `status-card status-${status}`;

    if (status === 'confirmado') {
      if (icon) icon.textContent = '🎉';
      if (badge) {
        badge.textContent = 'CONFIRMADO COM SUCESSO';
        badge.style.background = 'rgba(37, 211, 102, 0.15)';
        badge.style.color = '#155724';
      }
      if (headline) headline.textContent = 'Seu Horário está Garantido! ✨';
      if (desc) desc.textContent = 'A Letícia confirmou seu agendamento no Studio! Estamos te esperando com muito carinho na Rua 26, nº 135 • Colmeia Park • Jataí - GO.';
      if (btnWpp) {
        const msgConfirm = encodeURIComponent(`Olá, Letícia! Vi que meu agendamento para ${dataFormatada} às ${horario} foi confirmado. Obrigada! ✨`);
        btnWpp.href = `https://wa.me/${studioNum}?text=${msgConfirm}`;
        btnWpp.innerHTML = '💬 Conversar com a Letícia no WhatsApp';
        btnWpp.style.background = '#25D366';
        btnWpp.style.color = '#FFFFFF';
        btnWpp.style.fontWeight = '700';
      }
    } else if (status === 'recusado') {
      if (icon) icon.textContent = '❌';
      if (badge) {
        badge.textContent = 'HORÁRIO INDISPONÍVEL';
        badge.style.background = 'rgba(220, 53, 69, 0.15)';
        badge.style.color = '#721c24';
      }
      if (headline) headline.textContent = 'Horário não pôde ser confirmado';
      if (desc) desc.textContent = data.motivo_recusa || 'Este horário acabou de ser preenchido ou está indisponível. Por favor, escolha outro dia ou fale diretamente com a Letícia pelo WhatsApp.';
      if (btnWpp) {
        const msgRecusa = encodeURIComponent(`Olá, Letícia! Tentei agendar para ${dataFormatada} às ${horario} mas estava indisponível. Podemos verificar outro horário?`);
        btnWpp.href = `https://wa.me/${studioNum}?text=${msgRecusa}`;
        btnWpp.innerHTML = '💬 Falar com a Letícia no WhatsApp';
        btnWpp.style.background = 'var(--bg-card-soft)';
        btnWpp.style.color = 'var(--primary)';
        btnWpp.style.fontWeight = '700';
      }
    } else {
      if (icon) icon.textContent = '⏳';
      if (badge) {
        badge.textContent = 'PRÉ-AGENDAMENTO SOLICITADO';
        badge.style.background = 'rgba(190, 122, 71, 0.15)';
        badge.style.color = 'var(--primary)';
      }
      if (headline) headline.textContent = 'Aguardando Confirmação da Letícia';
      if (desc) desc.textContent = 'Seu pedido foi registrado no sistema! O agendamento é FINALIZADO assim que a Letícia aprova na agenda. Você pode avisá-la no WhatsApp para aprovação imediata ou aguardar a confirmação automática nesta tela.';
      if (btnWpp) {
        const msgAviso = encodeURIComponent(
          `Olá, Letícia! Fiz um pré-agendamento pelo seu site:\n\n` +
          `👤 *Cliente:* ${clienteNome}\n` +
          `💆‍♀️ *Procedimento:* ${servicoNome}\n` +
          `🗓️ *Data:* ${dataFormatada} às ${horario}\n` +
          `💰 *Valor:* R$ ${preco.toFixed(2).replace('.', ',')}\n\n` +
          `Pode confirmar na sua agenda para mim, por favor? ✨`
        );
        btnWpp.href = `https://wa.me/${studioNum}?text=${msgAviso}`;
        btnWpp.innerHTML = '📲 Avisar a Letícia no WhatsApp (Aprovação Mais Rápida)';
        btnWpp.style.background = '#25D366';
        btnWpp.style.color = '#FFFFFF';
        btnWpp.style.fontWeight = '800';
      }
    }
  }

  newClientBooking() {
    if (this.clientStatusPoller) clearInterval(this.clientStatusPoller);
    const cloud = window.StudioCloud || (typeof StudioCloud !== 'undefined' ? StudioCloud : null);
    if (cloud && this.clientStatusRealtime) cloud.unsubscribe(this.clientStatusRealtime);
    window.history.pushState({}, '', window.location.pathname);
    const statusSection = document.getElementById('section-status-view');
    const formSection = document.getElementById('section-booking-form');
    if (statusSection) statusSection.style.display = 'none';
    if (formSection) formSection.style.display = 'block';
    this.selectedBookingTime = null;
    this.renderClientBookingSlots();
  }

  // ==========================================================================
  // INSTALAÇÃO DO APLICATIVO (PWA - PROGRESSIVE WEB APP)
  // ==========================================================================
  initPWAInstall() {
    this.deferredInstallPrompt = null;
    this.isStandaloneApp = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

    // Detecta se já está instalado
    if (this.isStandaloneApp) {
      this.updatePWAUI(true);
      return;
    }

    // Captura o evento nativo de instalação no Chrome / Edge / Android
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredInstallPrompt = e;
      this.updatePWAUI(false, true);
    });

    // Detecta quando a instalação foi concluída
    window.addEventListener('appinstalled', () => {
      this.deferredInstallPrompt = null;
      this.isStandaloneApp = true;
      this.updatePWAUI(true);
      this.showToast('Studio Letícia instalado com sucesso! 🎉');
    });

    // Atualização inicial da interface
    this.updatePWAUI(false, false);
  }

  updatePWAUI(isStandalone, hasPromptEvent = false) {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isDismissed = sessionStorage.getItem('studio_pwa_dismissed') === '1';

    const clientBanner = document.getElementById('pwa-install-banner');
    const appBanner = document.getElementById('app-pwa-banner');
    const loginBtn = document.getElementById('btn-login-install');
    const settingsTitle = document.getElementById('settings-pwa-title');
    const settingsSub = document.getElementById('settings-pwa-subtitle');

    if (isStandalone) {
      if (clientBanner) clientBanner.style.display = 'none';
      if (appBanner) appBanner.style.display = 'none';
      if (loginBtn) loginBtn.style.display = 'none';
      if (settingsTitle) settingsTitle.textContent = 'Aplicativo Instalado ✅';
      if (settingsSub) settingsSub.textContent = 'Você já está usando a versão oficial do aplicativo.';
      return;
    }

    // Se não estiver em modo standalone:
    if (loginBtn) loginBtn.style.display = 'flex';

    if (!isDismissed) {
      const isBookingView = document.getElementById('client-booking-view')?.style.display !== 'none';
      const isAppContainer = document.getElementById('app-container')?.style.display !== 'none';

      if (clientBanner && isBookingView) clientBanner.style.display = 'flex';
      if (appBanner && isAppContainer) appBanner.style.display = 'flex';
    }

    if (settingsTitle) settingsTitle.textContent = 'Instalar App no Celular';
    if (settingsSub) settingsSub.textContent = isIOS ? 'Toque para ver o passo a passo no iPhone' : 'Abra em tela cheia direto da tela inicial';
  }

  async promptInstallPWA() {
    if (this.isStandaloneApp) {
      this.showToast('O aplicativo já está instalado no seu aparelho! ✨');
      return;
    }

    // Se temos o prompt nativo pronto (Android / Chrome)
    if (this.deferredInstallPrompt) {
      try {
        this.deferredInstallPrompt.prompt();
        const choice = await this.deferredInstallPrompt.userChoice;
        if (choice && choice.outcome === 'accepted') {
          this.dismissInstallBanner();
          this.dismissAppInstallBanner();
        }
        this.deferredInstallPrompt = null;
        return;
      } catch (err) {
        console.warn('Erro ao abrir prompt nativo de instalação:', err);
      }
    }

    // Caso seja iOS Safari ou navegador que não dispare beforeinstallprompt
    const isIOS = (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) && !window.MSStream;
    this.openPWAInstallGuide(isIOS ? 'ios' : 'other');
  }

  openPWAInstallGuide(type = 'ios') {
    const modal = document.getElementById('modal-pwa-install-guide');
    const guideIos = document.getElementById('pwa-guide-ios');
    const guideOther = document.getElementById('pwa-guide-other');

    if (guideIos) guideIos.style.display = type === 'ios' ? 'block' : 'none';
    if (guideOther) guideOther.style.display = type === 'other' ? 'block' : 'none';

    if (modal) {
      modal.style.display = 'flex';
      modal.classList.add('active');
    }
  }

  closePWAInstallGuide() {
    const modal = document.getElementById('modal-pwa-install-guide');
    if (modal) {
      modal.classList.remove('active');
      modal.style.display = 'none';
    }
  }

  copyAppUrlForSafari() {
    const url = window.location.origin + window.location.pathname;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        alert('Link copiado com sucesso! Abra o Safari no seu iPhone e cole o link na barra de endereços.');
      }).catch(() => {
        prompt('Copie o link abaixo para abrir no Safari:', url);
      });
    } else {
      prompt('Copie o link abaixo para abrir no Safari:', url);
    }
  }

  dismissInstallBanner() {
    const banner = document.getElementById('pwa-install-banner');
    if (banner) banner.style.display = 'none';
    sessionStorage.setItem('studio_pwa_dismissed', '1');
  }

  dismissAppInstallBanner() {
    const banner = document.getElementById('app-pwa-banner');
    if (banner) banner.style.display = 'none';
    sessionStorage.setItem('studio_pwa_dismissed', '1');
  }
}

// Inicializa a aplicação
const app = new StudioApp();
