export const themeManager = {
    currentTheme: 'dark',
    
    initialize() {
      // Check if theme is saved in localStorage
      const savedTheme = localStorage.getItem('theme');
      if (savedTheme) {
        this.setTheme(savedTheme);
      } else {
        // Check system preference
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
          this.setTheme('dark');
        } else {
          this.setTheme('light');
        }
      }
      
      // Listen for system theme changes if set to 'system'
      if (this.currentTheme === 'system') {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
          this.applyTheme(e.matches ? 'dark' : 'light');
        });
      }
      
      // Update UI to reflect current theme
      this.updateUI();
    },
    
    setTheme(theme) {
      this.currentTheme = theme;
      localStorage.setItem('theme', theme);
      
      if (theme === 'system') {
        const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        this.applyTheme(isDarkMode ? 'dark' : 'light');
      } else {
        this.applyTheme(theme);
      }
      
      this.updateUI();
    },
    
    toggleTheme() {
      const newTheme = document.body.classList.contains('dark-theme') ? 'light' : 'dark';
      this.setTheme(newTheme);
    },
    
    applyTheme(theme) {
      if (theme === 'dark') {
        document.body.classList.add('dark-theme');
        document.body.classList.remove('light-theme');
        // Update theme toggle icon
        const themeIcon = document.querySelector('#theme-toggle .material-icons');
        if (themeIcon) themeIcon.textContent = 'light_mode';
      } else {
        document.body.classList.add('light-theme');
        document.body.classList.remove('dark-theme');
        // Update theme toggle icon
        const themeIcon = document.querySelector('#theme-toggle .material-icons');
        if (themeIcon) themeIcon.textContent = 'dark_mode';
      }
    },
    
    updateUI() {
      // Update theme option buttons
      document.querySelectorAll('.theme-option').forEach(option => {
        option.classList.toggle('active', option.dataset.theme === this.currentTheme);
      });
    }
  };