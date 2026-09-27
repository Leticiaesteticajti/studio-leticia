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
    this.isAuthenticated = this.checkAuth();

    const urlParams = new URLSearchParams(window.location.search);
    const wantsAdmin = urlParams.get('login') === 'true' || urlParams.get('admin') === 'true';

    if (this.isAuthenticated) {
      this.showAppView();
      this.setupDateDisplay();
      this.setupEventListeners();
      await this.loadInitialData();
      await this.loadTodayTab();
      this.checkOnlineRequests();
      setInterval(() => this.checkOnlineRequests(), 20000);
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
    this.allServices = await db.getAll('servicos');
    this.populateClientSelects();
    this.populateServiceSelects();
    this.syncServicesToCloud();
    this.syncAppointmentsToCloud();
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
    const pacoteTag = app.numSessao ? `<span class="app-package-tag">Sessão ${app.numSessao}</span>` : '';

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
          <span>${app.pago ? '✅ Pago (' + (app.formaPagamento || 'PIX').toUpperCase() + ')' : '⏳ Aguardando Pagamento'}</span>
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

    const msg = `Olá, ${app.clienteNome}! ✨\nPassando para confirmar seu horário de *${app.servicoNome}* com a Letícia no dia *${dataFormatada}* às *${app.horario}*.\n\nPodemos confirmar? Te espero com muito carinho! 💆‍♀️🌸`;

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
    const filtered = this.allClients.filter(c => 
      c.nome.toLowerCase().includes(query) || (c.whatsapp && c.whatsapp.includes(query))
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
              <div class="client-phone">📱 ${this.formatPhone(c.whatsapp)}</div>
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
        <div style="font-size: 0.95rem; margin-bottom: 6px;">
          <strong>WhatsApp:</strong> 
          <a href="https://api.whatsapp.com/send?phone=${cleanPhone}" target="_blank" style="color: var(--green-wpp-dark); text-decoration: none; font-weight: bold;">
            📱 ${this.formatPhone(client.whatsapp)} (Abrir WhatsApp)
          </a>
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
          <div style="font-weight: 700; font-size: 0.95rem;">📦 Pacotes de Sessões</div>
          <button class="btn-complete" style="font-size: 0.75rem; padding: 4px 8px;" onclick="app.promptAddPackage('${client.id}')">+ Novo Pacote</button>
        </div>
        <div id="client-packages-list">
          ${(client.pacotes && client.pacotes.length > 0) ? client.pacotes.map(p => `
            <div style="background: #FDF9F5; border: 1px solid var(--border-light); border-radius: 8px; padding: 10px; margin-bottom: 6px;">
              <div style="font-weight: 700; font-size: 0.88rem; color: var(--text-main);">${p.servicoNome}</div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px; font-size: 0.8rem;">
                <span style="color: #925D11; font-weight: 700;">Realizadas: ${p.sessoesFeitas} de ${p.totalSessoes}</span>
                <span class="app-status-badge ${p.sessoesFeitas >= p.totalSessoes ? 'status-concluido' : 'status-agendado'}">
                  ${p.sessoesFeitas >= p.totalSessoes ? 'Finalizado' : 'Em Andamento'}
                </span>
              </div>
            </div>
          `).join('') : '<div style="font-size: 0.82rem; color: var(--text-muted);">Nenhum pacote contratado.</div>'}
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
    const client = await db.get('clientes', clientId);
    if (!client) return;

    // Se houver planos cadastrados no catálogo, oferece seleção
    const catalogo = await db.getAll('catalogo_pacotes');
    let nomePacote = 'Pacote Drenagem 5 Sessões';
    let totalSessoes = 5;
    let valorTotal = 580.00;

    if (catalogo.length > 0) {
      const opcoes = catalogo.map((p, idx) => `${idx + 1}: ${p.nome} (${p.qtdSessoes}x - ${this.formatCurrency(p.preco)})`).join('\n');
      const escolha = prompt(`Escolha um plano do catálogo pelo número ou digite 0 para criar avulso:\n\n${opcoes}\n0: Criar plano avulso`);
      
      const idxEscolhido = parseInt(escolha, 10) - 1;
      if (idxEscolhido >= 0 && idxEscolhido < catalogo.length) {
        const pSel = catalogo[idxEscolhido];
        nomePacote = pSel.nome;
        totalSessoes = pSel.qtdSessoes;
        valorTotal = pSel.preco;
      } else if (escolha === '0') {
        nomePacote = prompt('Nome do Pacote:', 'Pacote Drenagem 5 Sessões') || nomePacote;
        totalSessoes = parseInt(prompt('Quantidade total de sessões:', '5'), 10) || 5;
        valorTotal = parseFloat(prompt('Valor total do pacote (R$):', '580.00')) || 0;
      } else {
        return;
      }
    } else {
      nomePacote = prompt('Nome do Pacote (ex: Pacote Drenagem 5x):', 'Pacote Drenagem 5 Sessões');
      if (!nomePacote) return;
      totalSessoes = parseInt(prompt('Quantidade total de sessões:', '5'), 10) || 5;
      valorTotal = parseFloat(prompt('Valor total do pacote (R$):', '580.00')) || 0;
    }

    const novoPacote = {
      id: 'pct_' + Date.now(),
      servicoNome: nomePacote,
      totalSessoes: totalSessoes,
      sessoesFeitas: 0,
      valorTotal: valorTotal,
      status: 'ativo',
      criadoEm: new Date().toISOString()
    };

    if (!client.pacotes) client.pacotes = [];
    client.pacotes.push(novoPacote);
    await db.put('clientes', client);

    // Lança a venda do pacote no caixa se desejar
    const lancarCaixa = confirm('Deseja registrar essa entrada de ' + this.formatCurrency(valorTotal) + ' no Fluxo de Caixa agora?');
    if (lancarCaixa && valorTotal > 0) {
      await db.put('transacoes', {
        id: 'tx_' + Date.now(),
        tipo: 'entrada',
        descricao: `Venda de ${nomePacote} - ${client.nome}`,
        categoria: 'pacote',
        valor: valorTotal,
        data: new Date().toISOString().split('T')[0],
        formaPagamento: 'pix',
        criadoEm: new Date().toISOString()
      });
    }

    this.showToast('Plano ativado para a cliente! ✨');
    this.viewClientDetails(clientId);
    this.loadTodayTab();
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
    const bookingUrl = window.location.origin + window.location.pathname.replace('index.html', '');
    const display = document.getElementById('booking-public-url-display');
    if (display) display.textContent = bookingUrl;

    const urlInput = document.getElementById('setting-supabase-url');
    const keyInput = document.getElementById('setting-supabase-key');
    if (urlInput) urlInput.value = localStorage.getItem('studio_supabase_url') || '';
    if (keyInput) keyInput.value = localStorage.getItem('studio_supabase_key') || '';
  }

  copyBookingLink() {
    const bookingUrl = window.location.origin + window.location.pathname.replace('index.html', '');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(bookingUrl).then(() => {
        this.showToast('Link Oficial do Studio copiado para o WhatsApp! 📋✨');
      }).catch(() => {
        prompt('Copie o link abaixo para enviar às clientes:', bookingUrl);
      });
    } else {
      prompt('Copie o link abaixo para enviar às clientes:', bookingUrl);
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
  // GESTÃO DE SOLICITAÇÕES ONLINE (SUPABASE)
  // =========================================================================
  async checkOnlineRequests() {
    const cloud = window.StudioCloud || (typeof StudioCloud !== 'undefined' ? StudioCloud : null);
    if (!cloud) return;
    try {
      const pending = await cloud.getPendingRequests();
      const banner = document.getElementById('online-requests-banner');
      const countEl = document.getElementById('online-requests-count');
      
      if (banner && countEl) {
        if (pending.length > 0) {
          countEl.textContent = pending.length;
          banner.style.display = 'block';
        } else {
          banner.style.display = 'none';
        }
      }
    } catch (err) {
      console.warn('Erro ao verificar agendamentos online:', err);
    }
  }

  openOnlineRequestsModal() {
    const modal = document.getElementById('modal-online-requests');
    if (modal) {
      modal.classList.add('active');
      this.renderOnlineRequests();
    }
  }

  async renderOnlineRequests() {
    const container = document.getElementById('online-requests-list');
    if (!container) return;

    container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px;">Carregando pedidos...</div>';

    const pending = await StudioCloud.getPendingRequests();

    if (pending.length === 0) {
      container.innerHTML = `
        <div class="card" style="text-align: center; color: var(--text-muted); padding: 30px 20px;">
          <div style="font-size: 2rem; margin-bottom: 8px;">✨</div>
          <div style="font-weight: 600; color: var(--text-main);">Nenhum pedido pendente</div>
          <div style="font-size: 0.8rem; margin-top: 4px;">Quando uma cliente solicitar horário pelo seu link, ele aparecerá aqui para você aprovar!</div>
        </div>
      `;
      this.checkOnlineRequests();
      return;
    }

    const htmls = [];
    for (const req of pending) {
      const conflict = await this.checkTimeConflict(req.data, req.horario, req.duracao_min || 60);
      const [ano, mes, dia] = (req.data || '').split('-');
      const dataFormatada = dia && mes ? `${dia}/${mes}/${ano}` : req.data;

      htmls.push(`
        <div style="background: var(--bg-card-tint); border: 1.5px solid var(--border-color); border-radius: var(--radius-md); padding: 16px; position: relative;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
            <div>
              <div style="font-size: 1.05rem; font-weight: 700; color: var(--primary);">${this.escapeHtml(req.cliente_nome)}</div>
              <div style="font-size: 0.8rem; color: var(--text-muted);">📱 ${this.escapeHtml(req.cliente_whatsapp)}</div>
            </div>
            <span style="background: #FFF4E5; color: #925D11; font-size: 0.72rem; font-weight: bold; padding: 4px 8px; border-radius: 6px;">Pendente</span>
          </div>

          <div style="background: #FFFFFF; border: 1px solid var(--border-light); border-radius: 8px; padding: 10px; margin-bottom: 12px; font-size: 0.85rem;">
            <div style="font-weight: 600; color: var(--text-main);">${this.escapeHtml(req.servico_nome)}</div>
            <div style="color: var(--text-muted); margin-top: 2px;">
              🗓️ <strong>${dataFormatada}</strong> às <strong>${req.horario}</strong> (${req.duracao_min || 60} min)
            </div>
            <div style="color: var(--primary); font-weight: bold; margin-top: 2px;">
              Valor: ${this.formatCurrency(req.servico_preco || 0)}
            </div>
            ${req.observacoes ? `<div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 6px;">📝 "${this.escapeHtml(req.observacoes)}"</div>` : ''}
          </div>

          ${conflict.hasConflict ? `
            <div style="background: #FBEBEB; border: 1px solid #F5C6C6; color: var(--danger); font-size: 0.78rem; padding: 8px 10px; border-radius: 8px; margin-bottom: 12px;">
              ⚠️ <strong>Atenção:</strong> Você já possui um atendimento neste horário (${conflict.intervalo})!
            </div>
          ` : ''}

          <div style="display: flex; gap: 8px;">
            <button type="button" class="btn-complete" style="flex: 2; padding: 10px; font-size: 0.85rem;" onclick="app.confirmOnlineRequest('${req.id}')">
              ✅ Confirmar Horário
            </button>
            <button type="button" class="quick-btn" style="flex: 1; justify-content: center; color: var(--danger); border-color: rgba(185,55,40,0.3); padding: 10px; font-size: 0.85rem;" onclick="app.rejectOnlineRequest('${req.id}')">
              ❌ Recusar
            </button>
          </div>
        </div>
      `);
    }

    container.innerHTML = htmls.join('');
  }

  async confirmOnlineRequest(requestId) {
    try {
      const pending = await StudioCloud.getPendingRequests();
      const req = pending.find(r => r.id === requestId);
      if (!req) return;

      // 1. Atualiza status no Supabase (assim a tela da cliente muda para CONFIRMADO)
      await StudioCloud.confirmBooking(requestId);

      // 2. Garante que a cliente existe no cadastro local de clientes
      let cliente = this.allClients.find(c => {
        const cWpp = (c.whatsapp || '').replace(/\D/g, '');
        const rWpp = (req.cliente_whatsapp || '').replace(/\D/g, '');
        return cWpp && rWpp && cWpp === rWpp;
      });

      if (!cliente) {
        cliente = {
          id: 'cli_' + Date.now(),
          nome: req.cliente_nome,
          whatsapp: req.cliente_whatsapp,
          anamnese: 'Cadastrada via Agendamento Online',
          cirurgiaRecente: 'nao',
          pressaoHabitual: 'normal',
          pacotes: [],
          criadoEm: new Date().toISOString()
        };
        await db.put('clientes', cliente);
        this.allClients.push(cliente);
        this.populateClientSelects();
      }

      // 3. Insere o agendamento na grade local da Letícia
      const novoAgendamento = {
        id: 'agd_' + Date.now(),
        clienteId: cliente.id,
        clienteNome: cliente.nome,
        servicoId: req.servico_id || 'srv_1',
        servicoNome: req.servico_nome,
        valor: parseFloat(req.servico_preco) || 0,
        data: req.data,
        horario: req.horario,
        duracaoMin: req.duracao_min || 60,
        status: 'agendado',
        pago: false,
        formaPagamento: '',
        notas: 'Agendado online pela cliente',
        criadoEm: new Date().toISOString()
      };

      await db.put('agendamentos', novoAgendamento);

      this.showToast(`Agendamento de ${cliente.nome} CONFIRMADO com sucesso! 🎉`);

      // 4. Monta link de WhatsApp para avisar a cliente com 1 toque
      const [ano, mes, dia] = (req.data || '').split('-');
      const dataFormatada = dia && mes ? `${dia}/${mes}/${ano}` : req.data;
      const wppNum = (req.cliente_whatsapp || '').replace(/\D/g, '');
      const msg = encodeURIComponent(`Olá, ${cliente.nome}! ✨ Passando para confirmar que seu horário no Studio Letícia foi CONFIRMADO com sucesso para ${dataFormatada} às ${req.horario} (${req.servico_nome}). Te espero com carinho! 💆‍♀️🌸`);
      
      if (confirm('Deseja enviar a mensagem de confirmação para o WhatsApp da cliente agora?')) {
        window.open(`https://wa.me/55${wppNum}?text=${msg}`, '_blank');
      }

      await this.loadTodayTab();
      if (this.currentTab === 'agenda') await this.loadAgendaTab();
      await this.renderOnlineRequests();
    } catch (err) {
      console.error(err);
      alert('Erro ao confirmar agendamento: ' + err.message);
    }
  }

  async rejectOnlineRequest(requestId) {
    const motivo = prompt('Motivo da recusa (opcional, será exibido para a cliente):', 'Horário indisponível no momento.');
    if (motivo === null) return;

    try {
      await StudioCloud.rejectBooking(requestId, motivo);
      this.showToast('Solicitação recusada.');
      await this.renderOnlineRequests();
      this.checkOnlineRequests();
    } catch (err) {
      alert('Erro ao recusar: ' + err.message);
    }
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
        container.innerHTML = this.allServices.map(s => `
          <div style="background: var(--bg-card-soft); border: 1px solid var(--border-light); border-radius: var(--radius-md); padding: 14px; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-weight: 700; font-size: 0.95rem; color: var(--text-main);">${s.nome}</div>
              <div style="font-size: 0.76rem; color: var(--text-muted); margin-top: 2px;">
                ${s.categoria || 'Geral'} • ⏱️ ${s.duracaoMin || 60} minutos
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 10px;">
              <strong style="font-size: 1.05rem; color: var(--primary);">${this.formatCurrency(s.preco)}</strong>
              <button class="icon-btn" style="width: 32px; height: 32px; font-size: 0.8rem;" onclick="app.editServicePrice('${s.id}')" title="Alterar Preço">✏️</button>
              <button class="icon-btn" style="width: 32px; height: 32px; font-size: 0.8rem; color: var(--danger);" onclick="app.deleteService('${s.id}')" title="Excluir">🗑️</button>
            </div>
          </div>
        `).join('');
      }
    }

    this.openModal('modal-price-table');
  }

  async editServicePrice(id) {
    const servico = await db.get('servicos', id);
    if (!servico) return;

    const novoPreco = prompt(`Alterar valor de "${servico.nome}":\n\nNovo valor em R$:`, servico.preco);
    if (novoPreco === null) return;

    const valorFloat = parseFloat(novoPreco.replace(',', '.')) || 0;
    servico.preco = valorFloat;
    await db.put('servicos', servico);
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
        container.innerHTML = catalogo.map(p => `
          <div style="background: var(--bg-card-tint); border: 1px solid var(--border-color); border-left: 4px solid var(--primary); border-radius: var(--radius-md); padding: 14px; position: relative;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
              <div>
                <div style="font-weight: 800; font-size: 1rem; color: var(--text-main);">${p.nome}</div>
                <div style="font-size: 0.8rem; color: var(--primary); font-weight: 600; margin-top: 2px;">
                  ✨ ${p.qtdSessoes} Sessões • ${p.servicoNome || 'Procedimento'}
                </div>
                ${p.frequenciaTexto ? `<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">📅 ${p.frequenciaTexto}</div>` : ''}
                ${p.descricao ? `<div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 4px;"><em>${p.descricao}</em></div>` : ''}
              </div>
              <div style="text-align: right;">
                <div style="font-size: 1.1rem; font-weight: 800; color: var(--primary);">${this.formatCurrency(p.preco)}</div>
                <button class="icon-btn" style="width: 28px; height: 28px; font-size: 0.75rem; margin-top: 6px; margin-left: auto;" onclick="app.deletePackageCatalog('${p.id}')" title="Excluir Plano">🗑️</button>
              </div>
            </div>
          </div>
        `).join('');
      }
    }

    this.openModal('modal-packages-catalog');
  }

  async openNewPackageModal() {
    this.allServices = await db.getAll('servicos');
    const select = document.getElementById('pkg-service-select');
    if (select) {
      select.innerHTML = '<option value="">Selecione o procedimento...</option>' + 
        this.allServices.map(s => `<option value="${s.nome}">${s.nome}</option>`).join('');
    }

    document.getElementById('form-new-package').reset();
    document.getElementById('pkg-sessions').value = '3';
    this.openModal('modal-new-package');
  }

  async savePackageCatalog(e) {
    if (e) e.preventDefault();
    try {
      const nome = (document.getElementById('pkg-name').value || '').trim();
      const servicoNome = document.getElementById('pkg-service-select').value;
      const qtdSessoes = parseInt(document.getElementById('pkg-sessions').value, 10) || 3;
      const preco = parseFloat(document.getElementById('pkg-price').value) || 0;
      const validade = document.getElementById('pkg-validity').value || '';
      const desc = document.getElementById('pkg-desc').value || '';

      if (!nome) {
        alert('Por favor, informe o nome do plano/pacote.');
        return;
      }

      await db.put('catalogo_pacotes', {
        id: 'pct_cat_' + Date.now(),
        nome,
        servicoNome,
        qtdSessoes,
        frequenciaTexto: validade,
        preco,
        descricao: desc,
        criadoEm: new Date().toISOString()
      });

      this.closeModal('modal-new-package');
      this.showToast('Plano cadastrado com sucesso no Catálogo! 📦✨');
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
    const nome = document.getElementById('srv-name').value;
    const preco = parseFloat(document.getElementById('srv-price').value) || 0;
    const duracaoMin = parseInt(document.getElementById('srv-duration').value, 10) || 60;
    const categoria = document.getElementById('srv-cat').value;

    await db.put('servicos', {
      id: 'srv_' + Date.now(),
      nome,
      preco,
      duracaoMin,
      categoria,
      isPacote: categoria === 'Pacotes'
    });

    this.closeModal('modal-service');
    document.getElementById('form-service').reset();
    await this.loadInitialData();
    await this.openPriceTableModal();
    this.showToast('Procedimento cadastrado com sucesso!');
  }

  async deleteService(id) {
    if (confirm('Deseja realmente remover este procedimento da tabela?')) {
      await db.delete('servicos', id);
      await this.loadInitialData();
      await this.openPriceTableModal();
      this.showToast('Procedimento excluído.');
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
    if (servico) {
      document.getElementById('app-price').value = servico.preco;
      document.getElementById('app-duration').value = servico.duracaoMin || 60;
    }
  }

  onAppointmentClientChange() {
    const clientId = document.getElementById('app-client-select').value;
    const client = this.allClients.find(c => c.id === clientId);
    const box = document.getElementById('app-package-option-box');
    const select = document.getElementById('app-package-select');

    if (client && client.pacotes && client.pacotes.some(p => p.sessoesFeitas < p.totalSessoes)) {
      box.style.display = 'block';
      select.innerHTML = '<option value="">Não (Cobrar avulso)</option>' + 
        client.pacotes
          .filter(p => p.sessoesFeitas < p.totalSessoes)
          .map(p => `<option value="${p.id}">${p.servicoNome} (Sessão ${p.sessoesFeitas + 1} de ${p.totalSessoes})</option>`).join('');
    } else {
      box.style.display = 'none';
      select.innerHTML = '<option value="">Não (Cobrar avulso)</option>';
    }
  }

  openNewAppointmentModal(dataPadrao) {
    document.getElementById('form-appointment').reset();
    document.getElementById('app-id').value = '';
    document.getElementById('modal-appointment-title').textContent = 'Novo Agendamento';
    document.getElementById('app-date').value = dataPadrao || this.selectedAgendaDate;
    document.getElementById('app-time').value = '14:00';
    document.getElementById('app-package-option-box').style.display = 'none';

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
      if (pacoteId && cliente && cliente.pacotes) {
        const pacote = cliente.pacotes.find(p => p.id === pacoteId);
        if (pacote) {
          numSessao = pacote.sessoesFeitas + 1;
        }
      }

      const agendamento = {
        id,
        clienteId,
        clienteNome: cliente ? cliente.nome : 'Cliente',
        whatsapp: cliente ? cliente.whatsapp : '',
        servicoId,
        servicoNome: servico ? servico.nome : 'Serviço',
        data,
        horario,
        duracaoMin,
        valor: pacoteId ? 0 : valor,
        status: 'agendado',
        pago: pacoteId ? true : false,
        formaPagamento: pacoteId ? 'pacote' : null,
        pacoteId,
        numSessao,
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
    document.getElementById('complete-summary-service').textContent = 
      `${agendamento.servicoNome} • Agendado para ${agendamento.horario}`;
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
            pacote.sessoesFeitas = Math.min(pacote.totalSessoes, (pacote.sessoesFeitas || 0) + 1);
            await db.put('clientes', cliente);
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
    document.getElementById('form-client').reset();
    document.getElementById('client-id').value = '';
    document.getElementById('modal-client-title').textContent = 'Cadastrar Cliente';
    document.getElementById('client-preferencia-sessao').value = 'Com música relaxante';
    this.openModal('modal-client');
  }

  async editClient(id) {
    const client = await db.get('clientes', id);
    if (!client) return;

    this.closeModal('modal-client-details');
    document.getElementById('client-id').value = client.id;
    document.getElementById('modal-client-title').textContent = 'Editar Cliente';
    document.getElementById('client-name').value = client.nome || '';
    document.getElementById('client-phone').value = client.whatsapp || '';
    document.getElementById('client-birthdate').value = client.nascimento || '';
    document.getElementById('client-peso').value = client.peso || (client.anamnese ? client.anamnese.peso : '') || '';
    document.getElementById('client-preferencia-sessao').value = client.preferenciaSessao || 'Com música relaxante';
    document.getElementById('client-notes').value = client.notas || '';

    const an = client.anamnese || {};
    document.getElementById('anamnese-queixa').value = an.queixaPrincipal || '';
    document.getElementById('anamnese-cirurgia').value = an.cirurgiaRecente || '';
    document.getElementById('anamnese-alergias').value = an.alergias || '';
    document.getElementById('anamnese-restricoes').value = an.restricoes || '';

    this.openModal('modal-client');
  }

  async saveClient(e) {
    if (e) e.preventDefault();
    try {
      const id = document.getElementById('client-id').value || ('cli_' + Date.now());
      const nome = (document.getElementById('client-name').value || '').trim();
      const whatsapp = (document.getElementById('client-phone').value || '').trim();
      const nascimento = document.getElementById('client-birthdate').value;
      const peso = document.getElementById('client-peso').value;
      const preferenciaSessao = document.getElementById('client-preferencia-sessao').value;
      const notas = document.getElementById('client-notes').value;

      if (!nome) {
        alert('Por favor, preencha o Nome da cliente no topo do formulário.');
        document.getElementById('client-name').focus();
        return;
      }

      if (!whatsapp) {
        alert('Por favor, preencha o WhatsApp da cliente.');
        document.getElementById('client-phone').focus();
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
    if (modal) modal.classList.add('active');
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
    document.getElementById('form-service').reset();
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

  // =========================================================================
  // FLUXO PÚBLICO DE AGENDAMENTO DA CLIENTE (UNIFICADO NO MESMO LINK)
  // =========================================================================
  initClientBooking() {
    this.selectedBookingService = null;
    this.selectedBookingDate = null;
    this.selectedBookingTime = null;
    this.standardSlots = [
      '08:00', '09:00', '10:00', '11:00', 
      '13:30', '14:30', '15:30', '16:30', '17:30'
    ];

    this.setupClientPhoneMask();
    this.setupClientDateInput();

    const params = new URLSearchParams(window.location.search);
    const idFromUrl = params.get('id');

    if (idFromUrl) {
      this.showClientStatusView(idFromUrl);
    } else {
      this.loadClientBookingServices();
    }
  }

  setupClientPhoneMask() {
    const input = document.getElementById('client-whatsapp');
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
    try {
      const cloud = window.StudioCloud || (typeof StudioCloud !== 'undefined' ? StudioCloud : null);
      if (cloud && cloud.getPublicServices) {
        services = await cloud.getPublicServices();
      }
    } catch (e) {
      console.warn('Erro ao obter serviços:', e);
    }

    if (!services || services.length === 0) {
      services = [
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
    }

    this.clientPublicServices = services;

    container.innerHTML = services.map(s => `
      <div class="service-option" onclick="app.selectClientBookingService('${s.id}', this)">
        <div>
          <div class="service-name">${this.escapeHtml(s.nome)}</div>
          <div class="service-desc">⏱️ ${s.duracaoMin || 60} min • ${this.escapeHtml(s.descricao || 'Atendimento personalizado')}</div>
        </div>
        <div class="service-price">R$ ${Number(s.preco).toFixed(2).replace('.', ',')}</div>
      </div>
    `).join('');

    if (services.length > 0) {
      const first = container.querySelector('.service-option');
      if (first) first.click();
    }

    this.renderClientBookingSlots();
  }

  toggleClientServicesList() {
    const list = document.getElementById('services-list-container');
    const chevron = document.getElementById('service-chevron');
    if (!list) return;
    const isHidden = list.style.display === 'none' || !list.style.display;
    list.style.display = isHidden ? 'flex' : 'none';
    if (chevron) {
      chevron.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
    }
  }

  selectClientBookingService(id, el) {
    const service = (this.clientPublicServices || []).find(s => s.id === id);
    if (!service) return;
    this.selectedBookingService = service;
    document.querySelectorAll('.service-option').forEach(opt => opt.classList.remove('selected'));
    if (el) el.classList.add('selected');

    // Atualiza o display do botão seletor
    const display = document.getElementById('service-selected-display');
    if (display) {
      display.innerHTML = `
        <div style="display: flex; flex-direction: column;">
          <div style="font-size: 1rem; font-weight: 800; color: var(--primary);">
            ✨ ${this.escapeHtml(service.nome)}
          </div>
          <div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 2px;">
            ⏱️ ${service.duracaoMin || 60} min • ${this.formatCurrency(service.preco)}
          </div>
        </div>
      `;
    }

    // Fecha a lista suspensa
    const list = document.getElementById('services-list-container');
    const chevron = document.getElementById('service-chevron');
    if (list) list.style.display = 'none';
    if (chevron) chevron.style.transform = 'rotate(0deg)';
  }

  async syncServicesToCloud() {
    const cloud = window.StudioCloud || (typeof StudioCloud !== 'undefined' ? StudioCloud : null);
    if (!cloud || !cloud.isConfigured()) return;
    try {
      const servicos = await db.getAll('servicos');
      if (servicos && servicos.length > 0) {
        await cloud.syncServicesCatalog(servicos);
      }
    } catch (e) {
      console.warn('Aviso: falha ao sincronizar catálogo na nuvem:', e);
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

  async renderClientBookingSlots() {
    const container = document.getElementById('time-slots-container');
    if (!container || !this.selectedBookingDate) return;

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
    const nomeInput = document.getElementById('client-name');
    const wppInput = document.getElementById('client-whatsapp');
    const notesInput = document.getElementById('client-notes');

    const nome = (nomeInput ? nomeInput.value : '').trim();
    const wpp = (wppInput ? wppInput.value : '').replace(/\D/g, '');
    const notes = (notesInput ? notesInput.value : '').trim();

    if (!this.selectedBookingService) {
      alert('Por favor, selecione o procedimento que deseja realizar.');
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

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Enviando solicitação... ⏳';
    }

    try {
      const requestData = {
        cliente_nome: nome,
        cliente_whatsapp: wpp,
        servico_id: this.selectedBookingService.id,
        servico_nome: this.selectedBookingService.nome,
        servico_preco: this.selectedBookingService.preco,
        duracao_min: this.selectedBookingService.duracaoMin || 60,
        data: this.selectedBookingDate,
        horario: this.selectedBookingTime,
        observacoes: notes,
        status: 'pendente'
      };

      const cloud = window.StudioCloud || (typeof StudioCloud !== 'undefined' ? StudioCloud : null);
      if (!cloud) {
        throw new Error('Serviço de agendamento online não disponível.');
      }
      const result = await cloud.createBookingRequest(requestData);

      if (result && result.id) {
        const newUrl = `${window.location.pathname}?id=${result.id}`;
        window.history.pushState({ path: newUrl }, '', newUrl);
        this.showClientStatusView(result.id);
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

  async showClientStatusView(requestId) {
    const formSection = document.getElementById('section-booking-form');
    const statusSection = document.getElementById('section-status-view');
    if (formSection) formSection.style.display = 'none';
    if (statusSection) statusSection.style.display = 'block';

    window.scrollTo({ top: 0, behavior: 'smooth' });

    await this.updateClientStatusScreen(requestId);

    if (this.clientStatusPoller) clearInterval(this.clientStatusPoller);
    this.clientStatusPoller = setInterval(() => this.updateClientStatusScreen(requestId), 5000);
  }

  async updateClientStatusScreen(requestId) {
    const cloud = window.StudioCloud || (typeof StudioCloud !== 'undefined' ? StudioCloud : null);
    if (!cloud) return;
    const data = await cloud.getBookingRequestById(requestId);
    if (!data) return;

    const card = document.getElementById('status-card-element');
    const icon = document.getElementById('status-icon');
    const badge = document.getElementById('status-badge');
    const headline = document.getElementById('status-headline');
    const desc = document.getElementById('status-desc');
    const details = document.getElementById('status-details');
    const btnWpp = document.getElementById('btn-talk-leticia');

    const [ano, mes, dia] = (data.data || '').split('-');
    const dataFormatada = dia && mes ? `${dia}/${mes}/${ano}` : data.data;

    if (details) {
      details.innerHTML = `
        <div class="details-row">
          <span class="details-label">Cliente:</span>
          <span class="details-value">${this.escapeHtml(data.cliente_nome)}</span>
        </div>
        <div class="details-row">
          <span class="details-label">Procedimento:</span>
          <span class="details-value">${this.escapeHtml(data.servico_nome)}</span>
        </div>
        <div class="details-row">
          <span class="details-label">Data Solicitada:</span>
          <span class="details-value">${dataFormatada} às ${data.horario}</span>
        </div>
        <div class="details-row">
          <span class="details-label">Valor:</span>
          <span class="details-value">R$ ${Number(data.servico_preco || 0).toFixed(2).replace('.', ',')}</span>
        </div>
      `;
    }

    if (btnWpp) {
      const msgWpp = encodeURIComponent(`Olá, Letícia! Fiz um agendamento pelo seu site para ${dataFormatada} às ${data.horario} (${data.servico_nome}).`);
      const config = (await db.get('config', 'app_config')) || {};
      const studioNum = (config.studioPhone || '5564999999999').replace(/\D/g, '');
      btnWpp.href = `https://wa.me/${studioNum}?text=${msgWpp}`;
    }

    if (card) card.className = `status-card status-${data.status || 'pendente'}`;

    if (data.status === 'confirmado') {
      if (icon) icon.textContent = '🎉';
      if (badge) badge.textContent = 'CONFIRMADO COM SUCESSO';
      if (headline) headline.textContent = 'Seu Horário está Garantido! ✨';
      if (desc) desc.textContent = 'A Letícia confirmou seu agendamento no Studio. Estamos te esperando com muito carinho!';
    } else if (data.status === 'recusado') {
      if (icon) icon.textContent = '❌';
      if (badge) badge.textContent = 'HORÁRIO INDISPONÍVEL';
      if (headline) headline.textContent = 'Horário não pôde ser confirmado';
      if (desc) desc.textContent = data.motivo_recusa || 'Este horário acabou de ser preenchido. Por favor, escolha outro dia ou fale diretamente com a Letícia pelo WhatsApp.';
    } else {
      if (icon) icon.textContent = '⏳';
      if (badge) badge.textContent = 'SOLICITAÇÃO PENDENTE';
      if (headline) headline.textContent = 'Aguardando Confirmação da Letícia';
      if (desc) desc.textContent = 'Seu pedido foi enviado! A Letícia foi notificada e já vai aprovar seu horário. Esta tela atualiza sozinha.';
    }
  }

  newClientBooking() {
    if (this.clientStatusPoller) clearInterval(this.clientStatusPoller);
    window.history.pushState({}, '', window.location.pathname);
    const statusSection = document.getElementById('section-status-view');
    const formSection = document.getElementById('section-booking-form');
    if (statusSection) statusSection.style.display = 'none';
    if (formSection) formSection.style.display = 'block';
    this.selectedBookingTime = null;
    this.renderClientBookingSlots();
  }
}

// Inicializa a aplicação
const app = new StudioApp();
