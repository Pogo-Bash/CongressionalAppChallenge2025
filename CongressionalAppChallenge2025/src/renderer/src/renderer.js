import { authService } from '../../services/auth-service.js';
import { classroomService } from '../../services/classroom-service.js';
import { themeManager } from './theme-manager.js';

// For communication with Electron main process
const { ipcRenderer } = window.electron;

function initializeAuth() {
  const userSection = document.getElementById('user-section');
  const userAvatar = document.getElementById('user-avatar');
  const userName = document.getElementById('user-name');
  const loginButton = document.getElementById('login-button');
  const logoutButton = document.getElementById('logout-button');
  const curriculumLoginButton = document.getElementById('curriculum-login-button');
  
  // Handle login clicks
  loginButton?.addEventListener('click', async () => {
    try {
      await authService.login();
    } catch (error) {
      console.error('Login failed:', error);
      // Show error notification
    }
  });
  
  curriculumLoginButton?.addEventListener('click', async () => {
    try {
      await authService.login();
    } catch (error) {
      console.error('Login failed:', error);
      // Show error notification
    }
  });
  
  // Handle logout
  logoutButton?.addEventListener('click', async () => {
    try {
      await authService.logout();
    } catch (error) {
      console.error('Logout failed:', error);
    }
  });
  
  // Listen for auth state changes
  authService.addAuthListener((user) => {
    if (user) {
      // User is signed in
      userSection.style.display = 'flex';
      loginButton.style.display = 'none';
      
      // Update user info
      userAvatar.src = user.photoURL || './assets/default-avatar.png';
      userName.textContent = user.displayName || user.email;
      
      // Load Google Classroom data if on curriculum section
      if (document.getElementById('curriculum-section').classList.contains('active')) {
        loadCurriculumData();
      }
    } else {
      // User is signed out
      userSection.style.display = 'none';
      loginButton.style.display = 'flex';
      
      // Reset curriculum section
      document.getElementById('curriculum-content').style.display = 'none';
      document.getElementById('curriculum-not-logged-in').style.display = 'block';
      document.getElementById('curriculum-loading').style.display = 'none';
    }
  });
}

// Load curriculum data from Google Classroom
async function loadCurriculumData() {
  if (!authService.isLoggedIn()) {
    return;
  }
  
  const loadingIndicator = document.getElementById('curriculum-loading');
  const curriculumContent = document.getElementById('curriculum-content');
  const notLoggedIn = document.getElementById('curriculum-not-logged-in');
  const coursesContainer = document.getElementById('courses-container');
  
  // Show loading, hide other sections
  loadingIndicator.style.display = 'flex';
  curriculumContent.style.display = 'none';
  notLoggedIn.style.display = 'none';
  
  try {
    const courses = await classroomService.fetchCourses();
    
    // Clear existing courses
    coursesContainer.innerHTML = '';
    
    if (courses.length === 0) {
      coursesContainer.innerHTML = `
        <div class="empty-state">
          <p>No active courses found in your Google Classroom account.</p>
        </div>
      `;
    } else {
      // Display each course
      courses.forEach(course => {
        const courseCard = document.createElement('div');
        courseCard.className = 'course-card';
        courseCard.innerHTML = `
          <div class="course-name">${course.name}</div>
          <div class="course-section">${course.section || ''}</div>
          <div class="course-description">${course.description || 'No description available'}</div>
        `;
        
        // Add click handler to view course details
        courseCard.addEventListener('click', () => {
          viewCourseDetails(course.id);
        });
        
        coursesContainer.appendChild(courseCard);
      });
    }
    
    // Hide loading, show content
    loadingIndicator.style.display = 'none';
    curriculumContent.style.display = 'block';
  } catch (error) {
    console.error('Error loading curriculum data:', error);
    
    // Show error state
    loadingIndicator.style.display = 'none';
    curriculumContent.style.display = 'block';
    coursesContainer.innerHTML = `
      <div class="error-state">
        <p>Error loading your Google Classroom courses.</p>
        <button class="primary-button" id="retry-classroom">
          <span class="material-icons">refresh</span>
          Retry
        </button>
      </div>
    `;
    
    document.getElementById('retry-classroom')?.addEventListener('click', loadCurriculumData);
  }
}

async function viewCourseDetails(courseId) {
  // Implementation for viewing course work and details
  try {
    const courseWork = await classroomService.fetchCourseWork(courseId);
    // Display course work in a modal or new view
    console.log('Course work:', courseWork);
  } catch (error) {
    console.error('Error loading course details:', error);
  }
}

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
  initializeAuth();

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
      // Remove active class from all buttons and sections
      document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
      document.querySelectorAll('.content-section').forEach(section => section.classList.remove('active'));
      
      // Add active class to clicked button and corresponding section
      button.classList.add('active');
      const sectionId = button.dataset.section + '-section';
      document.getElementById(sectionId).classList.add('active');
      
      // If switching to curriculum section, load data
      if (sectionId === 'curriculum-section' && authService.isLoggedIn()) {
        loadCurriculumData();
      }
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


