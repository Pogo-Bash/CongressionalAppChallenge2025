import { focusTracker } from '../../../shared/js/components/focus-tracker.js';
import { themeManager } from './theme-manager.js';

// For communication with Electron main process
const { ipcRenderer } = window.electron;

// For the chart (Placeholder)
function createFocusChart() {
  const chartElement = document.getElementById('focus-chart');
  if (!chartElement) return;
  
  const chartHTML = `
    <div class="chart-placeholder">
      <svg width="100%" height="100%" viewBox="0 0 800 300">
        <line x1="0" y1="250" x2="800" y2="250" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
        <line x1="0" y1="200" x2="800" y2="200" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
        <line x1="0" y1="150" x2="800" y2="150" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
        <line x1="0" y1="100" x2="800" y2="100" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
        <line x1="0" y1="50" x2="800" y2="50" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
        <path d="M0,200 Q100,180 200,150 T400,100 T600,170 T800,120" fill="none" stroke="#3366ff" stroke-width="3"/>
        <path d="M0,180 Q100,200 200,220 T400,150 T600,190 T800,170" fill="none" stroke="#ff9966" stroke-width="3" stroke-dasharray="5,5"/>
        <text x="0" y="270" fill="#b0b7c3" font-size="12">Mon</text>
        <text x="133" y="270" fill="#b0b7c3" font-size="12">Tue</text>
        <text x="266" y="270" fill="#b0b7c3" font-size="12">Wed</text>
        <text x="399" y="270" fill="#b0b7c3" font-size="12">Thu</text>
        <text x="532" y="270" fill="#b0b7c3" font-size="12">Fri</text>
        <text x="665" y="270" fill="#b0b7c3" font-size="12">Sat</text>
        <text x="798" y="270" fill="#b0b7c3" font-size="12">Sun</text>
        <circle cx="650" cy="20" r="5" fill="#3366ff"/>
        <text x="660" y="25" fill="#ffffff" font-size="12">This week</text>
        <circle cx="740" cy="20" r="5" fill="#ff9966"/>
        <text x="750" y="25" fill="#ffffff" font-size="12">Last week</text>
      </svg>
    </div>
  `;
  chartElement.innerHTML = chartHTML;
}

// Window Control Buttons
document.addEventListener('DOMContentLoaded', () => {
  themeManager.initialize();
  createFocusChart();
  initNavigation();
  initSettings();

  document.getElementById('minimize')?.addEventListener('click', () => {
    ipcRenderer.send('window-control', 'minimize');
  });

  document.getElementById('maximize')?.addEventListener('click', () => {
    ipcRenderer.send('window-control', 'maximize');
  });

  document.getElementById('close')?.addEventListener('click', () => {
    ipcRenderer.send('window-control', 'close');
  });
});

// Initialize Navigation
function initNavigation() {
  document.querySelectorAll('.nav-btn').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
      document.querySelectorAll('.content-section').forEach(section => section.classList.remove('active'));

      button.classList.add('active');
      document.getElementById(`${button.dataset.section}-section`).classList.add('active');
    });
  });
}

// Initialize Settings
function initSettings() {
  document.querySelectorAll('.theme-option').forEach(option => {
    option.addEventListener('click', () => {
      const theme = option.dataset.theme;
      document.querySelectorAll('.theme-option').forEach(btn => btn.classList.remove('active'));
      option.classList.add('active');
      themeManager.setTheme(theme);
    });
  });

  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    themeManager.toggleTheme();
  });

  document.getElementById('connect-classroom')?.addEventListener('click', () => {
    console.log('Connecting to Google Classroom...');
  });
}
