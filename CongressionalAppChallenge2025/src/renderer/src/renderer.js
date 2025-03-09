// Import theme manager
import { themeManager } from './theme-manager.js'
import * as tf from '@tensorflow/tfjs'

// For communication with Electron main process
const { ipcRenderer } = window.electron || {}

// Firebase configuration from environment variables
const firebaseConfig = window.env?.firebaseConfig || {}

// Log that we're using environment variables (without exposing the actual values)
console.log(
  'Using Firebase config from environment variables:',
  Object.keys(firebaseConfig).filter((key) => !!firebaseConfig[key]).length + ' values configured'
)

// Import Firebase modules
import { initializeApp } from 'firebase/app'
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  onAuthStateChanged,
  signOut,
  getRedirectResult,
  setPersistence,
  browserLocalPersistence,
  signInWithCredential
} from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

// Initialize Firebase
let app
let auth
let db

try {
  app = initializeApp(firebaseConfig)
  auth = getAuth(app)

  // Add the persistence code right here:
  setPersistence(auth, browserLocalPersistence)
    .then(() => console.log('Firebase persistence set to local'))
    .catch((error) => console.error('Error setting persistence:', error))

  db = getFirestore(app)
  console.log('Firebase initialized successfully')
} catch (error) {
  console.error('Firebase initialization error:', error)
}

// Add Google Classroom scopes to the provider
const googleProvider = new GoogleAuthProvider()

if (window.env.firebaseConfig.clientId) {
  googleProvider.setCustomParameters({
    client_id: window.env.firebaseConfig.clientId
  })
}

googleProvider.addScope('https://www.googleapis.com/auth/classroom.courses.readonly')
googleProvider.addScope('https://www.googleapis.com/auth/classroom.coursework.me.readonly')
googleProvider.addScope('https://www.googleapis.com/auth/classroom.rosters.readonly')
googleProvider.addScope('https://www.googleapis.com/auth/classroom.profile.emails')

// Focus Sessions Management
let focusSessionsCache = []

// TensorFlow Model

let focusTrackingInitialized = false
let tensorflowModel = null
let faceDetector = null

async function initializeTensorFlow() {
  if (focusTrackingInitialized) return true

  try {
    console.log('Initializing TensorFlow.js...')

    // Import TensorFlow.js dynamically
    const tf = await import('@tensorflow/tfjs')

    // Set backend based on platform
    const backendNames = tf.engine().backendNames()
    console.log('Available backends:', backendNames)

    // Try to use WebGL if available (much faster)
    if (backendNames.includes('webgl')) {
      try {
        console.log('Setting WebGL backend...')
        await tf.setBackend('webgl')
        // Optimize WebGL for memory
        tf.env().set('WEBGL_FORCE_F16_TEXTURES', true)
        tf.env().set('WEBGL_CPU_FORWARD', true)
        console.log('Using WebGL backend')
      } catch (error) {
        console.warn('WebGL backend failed, falling back to CPU:', error)
        await tf.setBackend('cpu')
      }
    } else {
      await tf.setBackend('cpu')
      console.log('Using CPU backend')
    }

    // Import face-detection model dynamically
    const faceDetection = await import('@tensorflow-models/face-detection')

    // Load face detection model (BlazeFace is lighter/faster)
    const modelConfig = {
      modelType: 'short',
      runtime: 'tfjs',
      maxFaces: 1
    }

    console.log('Loading face detection model...')
    faceDetector = await faceDetection.createDetector(
      faceDetection.SupportedModels.BlazeFace,
      modelConfig
    )

    console.log('TensorFlow and face detection initialized successfully')
    focusTrackingInitialized = true
    return true
  } catch (error) {
    console.error('Failed to initialize TensorFlow:', error)
    throw error
  }
}

// Load focus sessions from local storage
function loadFocusSessions() {
  try {
    const savedSessions = localStorage.getItem('focusSessions')
    if (savedSessions) {
      focusSessionsCache = JSON.parse(savedSessions)
      console.log(`Loaded ${focusSessionsCache.length} focus sessions from storage`)
    }
  } catch (error) {
    console.error('Error loading focus sessions:', error)
  }
  return focusSessionsCache
}

// Save focus sessions to local storage
function saveFocusSessions(sessions) {
  try {
    localStorage.setItem('focusSessions', JSON.stringify(sessions))
    focusSessionsCache = sessions
    console.log(`Saved ${sessions.length} focus sessions to storage`)

    // Update dashboard with latest data
    updateDashboardWithFocusData(sessions)
  } catch (error) {
    console.error('Error saving focus sessions:', error)
  }
}

// Add a new focus session to storage
function saveNewFocusSession(session) {
  const sessions = loadFocusSessions()
  sessions.push({
    ...session,
    id: Date.now(), // Use timestamp as unique ID
    createdAt: new Date().toISOString()
  })

  // Keep only the 100 most recent sessions
  const trimmedSessions = sessions
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 100)
  saveFocusSessions(trimmedSessions)

  return trimmedSessions
}

// Export focus sessions to a JSON file
async function exportFocusSessions() {
  try {
    const sessions = loadAndUpdateFocusSessions()

    if (sessions.length === 0) {
      alert('No focus sessions to export')
      return
    }

    const dataStr = JSON.stringify(sessions, null, 2)
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr)

    const exportFileDefaultName = `focus-sessions-${new Date().toISOString().slice(0, 10)}.json`

    const linkElement = document.createElement('a')
    linkElement.setAttribute('href', dataUri)
    linkElement.setAttribute('download', exportFileDefaultName)
    linkElement.style.display = 'none'
    document.body.appendChild(linkElement) // Required for Firefox

    linkElement.click()

    document.body.removeChild(linkElement)
  } catch (error) {
    console.error('Error exporting focus sessions:', error)
    alert('Failed to export focus sessions')
  }
}

// Import focus sessions from a JSON file
async function importFocusSessions(fileInputEvent) {
  try {
    const file = fileInputEvent.target.files[0]
    if (!file) {
      return
    }

    const reader = new FileReader()

    reader.onload = function (event) {
      try {
        const importedSessions = JSON.parse(event.target.result)

        if (!Array.isArray(importedSessions)) {
          throw new Error('Invalid format: imported data is not an array')
        }

        const validSessions = importedSessions.filter((session) => {
          return (
            session.startTime &&
            (session.endTime || session.sessionDuration) &&
            typeof session.attentionScore === 'number'
          )
        })

        if (validSessions.length === 0) {
          throw new Error('No valid focus sessions found in the imported file')
        }

        // Get existing sessions
        let existingSessions = []
        try {
          const savedData = localStorage.getItem('focusSessions')
          if (savedData) {
            existingSessions = JSON.parse(savedData)
          }
        } catch (e) {
          console.warn('Could not load existing sessions, starting fresh')
          existingSessions = []
        }

        // Merge with existing sessions, avoiding duplicates by ID
        const existingIds = new Set(existingSessions.map((s) => s.id))

        const newSessions = [
          ...existingSessions,
          ...validSessions.filter((s) => !existingIds.has(s.id))
        ]

        // Sort and limit to 50 sessions
        const finalSessions = newSessions
          .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
          .slice(0, 50)

        // Save to localStorage
        localStorage.setItem('focusSessions', JSON.stringify(finalSessions))

        // Update the UI
        updateDashboardWithFocusData(finalSessions)

        // Show success message
        const notification = document.createElement('div')
        notification.className = 'notification'
        notification.textContent = `Successfully imported ${validSessions.length} focus sessions`
        document.body.appendChild(notification)

        setTimeout(() => {
          notification.classList.add('show')
        }, 10)

        setTimeout(() => {
          notification.classList.remove('show')
          setTimeout(() => {
            document.body.removeChild(notification)
          }, 300)
        }, 3000)
      } catch (error) {
        console.error('Error parsing imported file:', error)
        alert(`Error importing focus sessions: ${error.message}`)
      }
    }

    reader.onerror = function () {
      alert('Error reading the file')
    }

    reader.readAsText(file)
  } catch (error) {
    console.error('Error importing focus sessions:', error)
    alert(`Error importing focus sessions: ${error.message}`)
  }
}

// Central UI update function
function updateUI(user) {
  console.log('Updating UI based on auth state:', user ? 'Signed in' : 'Signed out')

  const userSection = document.getElementById('user-section')
  const loginButton = document.getElementById('login-button')

  if (!userSection || !loginButton) {
    console.error('Required UI elements not found')
    return
  }

  if (user) {
    // User is signed in
    console.log('User signed in, updating UI elements')
    userSection.style.display = 'flex'
    loginButton.style.display = 'none'

    // Update user info if elements exist
    const userAvatar = document.getElementById('user-avatar')
    const userName = document.getElementById('user-name')

    if (userAvatar) {
      userAvatar.src = user.photoURL || './assets/default-avatar.png'
      console.log('Set avatar to:', userAvatar.src)
    }

    if (userName) {
      userName.textContent = user.displayName || user.email
      console.log('Set username to:', userName.textContent)
    }

    // Check if we're in the curriculum section and load data
    const curriculumSection = document.getElementById('curriculum-section')
    if (curriculumSection && curriculumSection.classList.contains('active')) {
      loadCurriculumData()
    }
  } else {
    // User is signed out
    console.log('User signed out, updating UI elements')
    userSection.style.display = 'none'
    loginButton.style.display = 'flex'

    // Reset curriculum section
    const curriculumContent = document.getElementById('curriculum-content')
    const curriculumNotLoggedIn = document.getElementById('curriculum-not-logged-in')
    const curriculumLoading = document.getElementById('curriculum-loading')

    if (curriculumContent) curriculumContent.style.display = 'none'
    if (curriculumNotLoggedIn) curriculumNotLoggedIn.style.display = 'block'
    if (curriculumLoading) curriculumLoading.style.display = 'none'
  }
}

// Legacy function for backward compatibility
function updateUIForSignedInUser(user) {
  if (!user) return

  console.log('Updating UI for signed in user')

  // Just call our unified UI update function
  updateUI(user)
}

// Function to extract and store token
function extractAndStoreToken(result) {
  try {
    console.log('Extracting token from auth result')

    if (!result) {
      console.error('No result provided')
      return false
    }

    // Get the credential from the result
    const credential = GoogleAuthProvider.credentialFromResult(result)

    if (!credential) {
      console.error('No credential in auth result')
      return false
    }

    console.log('Got credential type:', typeof credential)
    const token = credential.accessToken

    if (!token) {
      console.error('No access token in credential')
      return false
    }

    console.log('Token obtained, length:', token.length)

    // Store the token
    localStorage.setItem('googleClassroomToken', token)
    console.log('Token stored in localStorage')

    // Also log if it can be retrieved
    const storedToken = localStorage.getItem('googleClassroomToken')
    console.log('Token retrieved from storage, length:', storedToken ? storedToken.length : 0)

    return true
  } catch (error) {
    console.error('Error extracting token:', error)
    return false
  }
}

// Authentication functions

async function signInWithGoogle(useSameAccount = true) {
  try {
    console.log('Starting Google sign-in process')

    // Clear any existing tokens that might be invalid
    localStorage.removeItem('googleClassroomToken')

    const provider = new GoogleAuthProvider()

    // Add scopes
    provider.addScope('https://www.googleapis.com/auth/classroom.courses.readonly')
    provider.addScope('https://www.googleapis.com/auth/classroom.coursework.me.readonly')
    provider.addScope('https://www.googleapis.com/auth/classroom.rosters.readonly')
    provider.addScope('https://www.googleapis.com/auth/classroom.profile.emails')

    // Set custom parameters - important for proper auth flow
    provider.setCustomParameters({
      prompt: 'consent', // Always ask for consent to refresh token
      access_type: 'offline' // Get refresh token
    })

    // Try popup first
    try {
      const result = await signInWithPopup(auth, provider)
      console.log('Sign-in successful with popup')

      // Extract token
      const credential = GoogleAuthProvider.credentialFromResult(result)
      if (credential && credential.accessToken) {
        localStorage.setItem('googleClassroomToken', credential.accessToken)
        console.log('Token saved successfully')
      }

      return result.user
    } catch (popupError) {
      console.error('Popup sign-in failed:', popupError)

      // For certain errors, try redirect method
      if (
        popupError.code === 'auth/popup-blocked' ||
        popupError.code === 'auth/cancelled-popup-request' ||
        popupError.code === 'auth/popup-closed-by-user'
      ) {
        await signInWithRedirect(auth, provider)
        return null
      } else {
        throw popupError
      }
    }
  } catch (error) {
    console.error('Sign-in error:', error)
    throw error
  }
}

let isAuthInProgress = false

function checkPopupBlocker() {
  // Special handling for Electron environment
  if (window.electron) {
    // In Electron, we assume popups are allowed since we've configured the main process to handle them
    console.log('Electron environment detected, assuming popups are allowed')
    return true
  }

  try {
    // Use a blank feature string for less visibility and use empty URL instead of about:blank
    const testPopup = window.open('', '_blank', 'width=1,height=1,left=-100,top=-100')

    if (!testPopup || testPopup.closed || typeof testPopup.closed === 'undefined') {
      console.warn('Popup blocker detected')
      return false
    }

    testPopup.close()
    return true
  } catch (e) {
    console.error('Error checking popup blocker', e)
    return false
  }
}

async function signInWithSameAccount() {
  if (isAuthInProgress) {
    console.log('Authentication already in progress, ignoring request')
    return null
  }

  isAuthInProgress = true

  try {
    console.log('Starting sign-in with same account')

    // Check if user is already signed in
    const currentUser = auth.currentUser
    if (currentUser) {
      console.log('User already signed in, refreshing token')

      // Try to refresh the token
      try {
        const idTokenResult = await currentUser.getIdTokenResult(true)
        console.log('Token refreshed successfully')

        // Get Google credential for token
        const credential = GoogleAuthProvider.credential(idTokenResult.token)
        const result = await signInWithCredential(auth, credential)

        extractAndStoreToken(result)
        return result.user
      } catch (refreshError) {
        console.warn('Token refresh failed, falling back to new sign-in:', refreshError)
        // Fall through to regular sign-in
      }
    }

    // Regular sign-in flow
    const provider = new GoogleAuthProvider()

    // Add necessary scopes
    provider.addScope('https://www.googleapis.com/auth/classroom.courses.readonly')
    provider.addScope('https://www.googleapis.com/auth/classroom.coursework.me.readonly')
    provider.addScope('https://www.googleapis.com/auth/classroom.rosters.readonly')
    provider.addScope('https://www.googleapis.com/auth/classroom.profile.emails')

    // Set minimal parameters
    provider.setCustomParameters({
      access_type: 'offline'
    })

    try {
      console.log('Attempting popup sign-in')
      const result = await signInWithPopup(auth, provider)
      console.log('Sign-in successful with popup')
      extractAndStoreToken(result)
      return result.user
    } catch (popupError) {
      console.error('Popup sign-in failed:', popupError)

      if (
        popupError.code === 'auth/popup-blocked' ||
        popupError.code === 'auth/cancelled-popup-request' ||
        popupError.code === 'auth/popup-closed-by-user'
      ) {
        console.log('Popup failed, trying redirect...')
        await signInWithRedirect(auth, provider)
        return null
      } else {
        throw popupError
      }
    }
  } catch (error) {
    console.error('Error in signInWithSameAccount:', error)
    throw error
  } finally {
    setTimeout(() => {
      isAuthInProgress = false
    }, 1000)
  }
}

async function signInWithNewAccount() {
  if (isAuthInProgress) {
    console.log('Authentication already in progress, ignoring request')
    return null
  }

  isAuthInProgress = true

  try {
    console.log('Starting sign-in with new account')

    // Clear existing authentication state
    localStorage.removeItem('googleClassroomToken')
    try {
      await signOut(auth)
    } catch (signOutError) {
      console.warn('Error signing out before new account auth:', signOutError)
    }

    const provider = new GoogleAuthProvider()
    provider.addScope('https://www.googleapis.com/auth/classroom.courses.readonly')
    provider.addScope('https://www.googleapis.com/auth/classroom.coursework.me.readonly')
    provider.addScope('https://www.googleapis.com/auth/classroom.rosters.readonly')
    provider.addScope('https://www.googleapis.com/auth/classroom.profile.emails')

    if (window.env?.firebaseConfig?.clientId) {
      provider.setCustomParameters({
        client_id: window.env.firebaseConfig.clientId,
        prompt: 'select_account',
        access_type: 'offline'
      })
    } else {
      provider.setCustomParameters({
        prompt: 'select_account',
        access_type: 'offline'
      })
    }

    try {
      console.log('Attempting popup sign-in with account selection')
      const result = await signInWithPopup(auth, provider)
      console.log('Sign-in successful with popup')
      extractAndStoreToken(result)
      return result.user
    } catch (popupError) {
      console.error('Popup sign-in failed:', popupError.code, popupError.message)

      if (
        popupError.code === 'auth/popup-blocked' ||
        popupError.code === 'auth/cancelled-popup-request' ||
        popupError.code === 'auth/popup-closed-by-user'
      ) {
        console.log('Popup failed, trying redirect method...')
        await signInWithRedirect(auth, provider)
        return null
      } else {
        throw popupError
      }
    }
  } catch (error) {
    console.error('Error in signInWithNewAccount:', error.code, error.message, error.stack)
    throw error
  } finally {
    setTimeout(() => {
      isAuthInProgress = false
    }, 1000)
  }
}

function showAccountSelectionModal() {
  const modal = document.getElementById('account-modal')
  if (!modal) {
    console.error('Account selection modal not found in the DOM')
    return
  }

  console.log('Showing account selection modal')
  modal.style.display = 'flex'

  // Handle "Use Same Account" button
  const useSameAccountButton = document.getElementById('use-same-account')
  if (useSameAccountButton) {
    // Remove existing event listeners by replacing the button
    const newSameAccountButton = useSameAccountButton.cloneNode(true)
    useSameAccountButton.parentNode.replaceChild(newSameAccountButton, useSameAccountButton)

    newSameAccountButton.addEventListener('click', async () => {
      console.log('Use Same Account button clicked')
      modal.style.display = 'none'

      // Short delay to ensure modal is closed before popup appears
      setTimeout(async () => {
        try {
          await signInWithSameAccount()
        } catch (error) {
          console.error('Sign-in with same account failed:', error)
          alert(`Sign-in failed: ${error.message}`)
        }
      }, 100)
    })
  }

  // Handle "Use Another Account" button
  const useAnotherAccountButton = document.getElementById('use-another-account')
  if (useAnotherAccountButton) {
    // Remove existing event listeners by replacing the button
    const newOtherAccountButton = useAnotherAccountButton.cloneNode(true)
    useAnotherAccountButton.parentNode.replaceChild(newOtherAccountButton, useAnotherAccountButton)

    newOtherAccountButton.addEventListener('click', async () => {
      console.log('Use Another Account button clicked')
      modal.style.display = 'none'

      // Short delay to ensure modal is closed before popup appears
      setTimeout(async () => {
        try {
          await signInWithNewAccount()
        } catch (error) {
          console.error('Sign-in with new account failed:', error)
          alert(`Sign-in failed: ${error.message}`)
        }
      }, 100)
    })
  }
}

// Modify your login button click handler to show the modal
document.getElementById('login-button')?.addEventListener('click', () => {
  console.log('Login button clicked')
  showAccountSelectionModal()
})

document.getElementById('curriculum-login-button')?.addEventListener('click', () => {
  console.log('Curriculum login button clicked')
  showAccountSelectionModal()
})

const logOut = async () => {
  try {
    await signOut(auth)
    localStorage.removeItem('googleClassroomToken')
    console.log('Sign out successful')
  } catch (error) {
    console.error('Error signing out', error)
    throw error
  }
}

async function checkAuthStatus() {
  if (!auth) {
    console.log('Auth not initialized')
    return null
  }

  return new Promise((resolve) => {
    // Add an observer for auth state changes
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      console.log('Initial auth state check:', user ? 'Signed in' : 'Signed out')
      unsubscribe() // Unsubscribe after initial check
      resolve(user)
    })
  })
}

// Handle the redirect result from Google sign-in
const handleRedirectResult = async () => {
  if (!auth) {
    console.log('Auth not initialized, cannot handle redirect result')
    return null
  }

  try {
    console.log('Checking for redirect result...')

    const result = await getRedirectResult(auth)

    if (result) {
      console.log('Successfully got redirect result')

      // Extract and store token
      const tokenSaved = extractAndStoreToken(result)
      console.log('Token saved from redirect:', tokenSaved)

      // Force update the UI
      updateUI(result.user)

      return result.user
    } else {
      console.log('No redirect result found')
      return null
    }
  } catch (error) {
    console.error('Error handling redirect result:', error)
    alert(`Authentication error: ${error.message}`)
    return null
  }
}

// Auth Service - this should be the only instance of authService in the app
const authService = {
  user: null,
  authListeners: [],

  async login(useSameAccount = true) {
    try {
      console.log('Login requested, useSameAccount:', useSameAccount)
      if (useSameAccount) {
        return await signInWithSameAccount()
      } else {
        return await signInWithNewAccount()
      }
    } catch (error) {
      console.error('Login error:', error)
      throw error
    }
  },

  async logout() {
    try {
      await logOut()
    } catch (error) {
      console.error('Logout error:', error)
      throw error
    }
  },

  getCurrentUser() {
    return this.user
  },

  isLoggedIn() {
    return !!this.user
  },

  addAuthListener(callback) {
    this.authListeners.push(callback)
    // Immediately call with current state
    callback(this.user)
    return () => {
      this.authListeners = this.authListeners.filter((cb) => cb !== callback)
    }
  },

  notifyListeners() {
    this.authListeners.forEach((callback) => callback(this.user))
  }
}

// Google Classroom Service
const classroomService = {
  baseUrl: 'https://classroom.googleapis.com/v1',
  courseData: null,

  getToken() {
    return localStorage.getItem('googleClassroomToken')
  },

  async testToken() {
    const token = this.getToken()
    if (!token) {
      throw new Error('No authentication token available')
    }

    try {
      // Make a simple API call to verify the token works
      const response = await fetch(`${this.baseUrl}/courses?pageSize=1`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('Token test failed:', errorText)

        if (response.status === 401) {
          // Token expired or invalid
          localStorage.removeItem('googleClassroomToken')
          throw new Error('Authentication token expired. Please sign in again.')
        }

        throw new Error(`API error: ${response.status}`)
      }

      console.log('Token test successful')
      return true
    } catch (error) {
      console.error('Token test error:', error)
      throw error
    }
  },

  async fetchCourses() {
    const token = this.getToken()
    if (!token) {
      throw new Error('Not authenticated with Google Classroom')
    }

    try {
      console.log('Fetching Google Classroom courses...')
      const response = await fetch(`${this.baseUrl}/courses?courseStates=ACTIVE`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('API error response:', errorText)

        if (response.status === 401) {
          localStorage.removeItem('googleClassroomToken')
          throw new Error('Authentication token expired. Please sign in again.')
        }

        throw new Error(`Failed to fetch courses: ${response.status}`)
      }

      const data = await response.json()
      console.log('Courses response data:', data)
      this.courseData = data.courses || []

      if (!data.courses || data.courses.length === 0) {
        console.log('No courses found in the response')
      } else {
        console.log(`Found ${data.courses.length} courses`)
      }

      return this.courseData
    } catch (error) {
      console.error('Error fetching Google Classroom courses:', error)

      // Handle token expired error
      if (error.message.includes('401')) {
        localStorage.removeItem('googleClassroomToken')
        throw new Error('Google Classroom session expired. Please sign in again.')
      }

      throw error
    }
  },

  async fetchCourseWork(courseId) {
    const token = this.getToken()
    if (!token) {
      throw new Error('Not authenticated with Google Classroom')
    }

    try {
      console.log(`Fetching coursework for course ${courseId}...`)
      const response = await fetch(`${this.baseUrl}/courses/${courseId}/courseWork`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      if (!response.ok) {
        if (response.status === 401) {
          localStorage.removeItem('googleClassroomToken')
          throw new Error('Authentication token expired. Please sign in again.')
        }

        throw new Error(`Failed to fetch coursework: ${response.status}`)
      }

      const data = await response.json()
      console.log('Coursework fetched:', data.courseWork ? data.courseWork.length : 0)
      return data.courseWork || []
    } catch (error) {
      console.error(`Error fetching coursework for course ${courseId}:`, error)
      throw error
    }
  },

  getCourseData() {
    return this.courseData
  }
}

// TensorFlow-based Focus Tracking
class FocusTracker {
  constructor() {
    this.isTracking = false
    this.focusData = this.resetFocusData()
    this.videoElement = null
    this.canvasElement = null
    this.canvasContext = null
    this.trackingInterval = null
    this.timerInterval = null
    this.blinkThreshold = 0.3
    this.modelLoaded = false
    this.domElements = {}
    this.savedSessions = []
    this.loadSavedSessions()
  }

  resetFocusData() {
    return {
      startTime: null,
      endTime: null,
      sessionDuration: 0,
      blinkRate: 0,
      attentionScore: 100,
      distractions: 0,
      blinkEvents: [],
      faceDetections: [],
      focusScoreHistory: []
    }
  }

  loadSavedSessions() {
    try {
      const savedData = localStorage.getItem('focusSessions')
      if (savedData) {
        this.savedSessions = JSON.parse(savedData)
        console.log(`Loaded ${this.savedSessions.length} focus sessions from storage`)
      }
    } catch (error) {
      console.error('Error loading saved sessions:', error)
      this.savedSessions = []
    }
  }

  saveSessions() {
    try {
      localStorage.setItem('focusSessions', JSON.stringify(this.savedSessions))
      console.log(`Saved ${this.savedSessions.length} focus sessions to storage`)

      // Update dashboard if available
      updateDashboardWithFocusData(this.savedSessions)
    } catch (error) {
      console.error('Error saving sessions:', error)
    }
  }

  async initialize(containerElement) {
    if (!containerElement) {
      console.error('No container element provided for focus tracker')
      return false
    }

    try {
      // Create UI
      this.createUI(containerElement)

      // Setup canvas for visualization
      this.setupCanvas()

      // Show loading state
      this.showLoadingState(true)

      // Initialize TensorFlow
      try {
        await initializeTensorFlow()
        this.modelLoaded = true
      } catch (error) {
        console.error('Failed to initialize TensorFlow:', error)
        this.showLoadingState(false, error.message)
        return false
      }

      // Setup event listeners
      this.setupEventListeners()

      // Hide loading state and show main content
      this.showLoadingState(false)

      // Display previous sessions
      this.updateSessionsList()

      return true
    } catch (error) {
      console.error('Error initializing focus tracker:', error)
      this.showError(`Failed to initialize focus tracking: ${error.message}`)
      this.showLoadingState(false, error.message)
      return false
    }
  }

  createUI(containerElement) {
    containerElement.innerHTML = `
      <div class="focus-tracker">
        <div class="focus-status">
          <div id="model-loading-status" class="loading-indicator">
            <span class="material-icons rotating">sync</span>
            <p>Loading focus tracking model...</p>
          </div>
          <div id="model-error" class="error-state" style="display: none;"></div>
        </div>
        
        <div class="focus-main-content" style="display: none;">
          <div class="focus-camera-container">
            <div class="video-container">
              <video id="focus-video" width="320" height="240" autoplay muted playsinline></video>
              <canvas id="focus-overlay" width="320" height="240"></canvas>
              <div class="face-detection-indicator" id="face-indicator">
                <span class="material-icons">face</span>
              </div>
            </div>
          </div>
          
          <div class="focus-stats">
            <div class="focus-score-container">
              <div class="focus-score">
                <span id="focus-score-value">100</span>
              </div>
              <div class="focus-score-label">Focus Score</div>
            </div>
            
            <div class="focus-metrics">
              <div class="metric-item">
                <span class="material-icons">visibility</span>
                <div>
                  <div class="metric-label">Blink Rate</div>
                  <div class="metric-value"><span id="blink-rate">0</span>/min</div>
                </div>
              </div>
              
              <div class="metric-item">
                <span class="material-icons">warning</span>
                <div>
                  <div class="metric-label">Distractions</div>
                  <div class="metric-value"><span id="distraction-count">0</span></div>
                </div>
              </div>
              
              <div class="metric-item">
                <span class="material-icons">timer</span>
                <div>
                  <div class="metric-label">Session Time</div>
                  <div class="metric-value"><span id="session-time">00:00</span></div>
                </div>
              </div>
            </div>
          </div>
          
          <div class="focus-controls">
            <button id="start-tracking" class="primary-button">
              <span class="material-icons">play_arrow</span>
              Start Tracking
            </button>
            <button id="stop-tracking" class="secondary-button" disabled>
              <span class="material-icons">stop</span>
              Stop Tracking
            </button>
          </div>
          
          <div class="focus-history">
            <h3>Recent Focus Sessions</h3>
            <div id="focus-sessions-list" class="sessions-list">
              <div class="empty-state">No recent focus sessions found</div>
            </div>
            
            <div class="focus-history-controls">
              <button id="export-sessions" class="secondary-button">
                <span class="material-icons">download</span>
                Export Data
              </button>
              <label for="import-sessions" class="secondary-button upload-button">
                <span class="material-icons">upload</span>
                Import Data
              </label>
              <input type="file" id="import-sessions" accept=".json" style="display: none;">
            </div>
          </div>
        </div>
        
        <div id="focus-error" class="focus-error" style="display: none;"></div>
      </div>
    `

    // Store references to DOM elements
    this.videoElement = document.getElementById('focus-video')
    this.canvasElement = document.getElementById('focus-overlay')
    this.domElements = {
      modelLoading: document.getElementById('model-loading-status'),
      modelError: document.getElementById('model-error'),
      mainContent: document.querySelector('.focus-main-content'),
      faceIndicator: document.getElementById('face-indicator'),
      focusScore: document.getElementById('focus-score-value'),
      blinkRate: document.getElementById('blink-rate'),
      distractionCount: document.getElementById('distraction-count'),
      sessionTime: document.getElementById('session-time'),
      startButton: document.getElementById('start-tracking'),
      stopButton: document.getElementById('stop-tracking'),
      errorContainer: document.getElementById('focus-error'),
      sessionsList: document.getElementById('focus-sessions-list'),
      exportButton: document.getElementById('export-sessions'),
      importInput: document.getElementById('import-sessions')
    }
  }

  setupCanvas() {
    if (this.canvasElement) {
      this.canvasContext = this.canvasElement.getContext('2d')
    }
  }

  showLoadingState(isLoading, errorMessage = '') {
    if (
      !this.domElements.modelLoading ||
      !this.domElements.modelError ||
      !this.domElements.mainContent
    ) {
      return
    }

    if (isLoading) {
      this.domElements.modelLoading.style.display = 'flex'
      this.domElements.modelError.style.display = 'none'
      this.domElements.mainContent.style.display = 'none'
    } else if (errorMessage) {
      this.domElements.modelLoading.style.display = 'none'
      this.domElements.modelError.style.display = 'block'
      this.domElements.mainContent.style.display = 'none'

      this.domElements.modelError.innerHTML = `
        <p>Error initializing focus tracking: ${errorMessage}</p>
        <button id="retry-model-loading" class="primary-button">
          <span class="material-icons">refresh</span>
          Retry
        </button>
      `

      document.getElementById('retry-model-loading')?.addEventListener('click', () => {
        this.showLoadingState(true)
        initializeTensorFlow()
          .then(() => {
            this.modelLoaded = true
            this.showLoadingState(false)
          })
          .catch((error) => {
            this.showLoadingState(false, error.message)
          })
      })
    } else {
      this.domElements.modelLoading.style.display = 'none'
      this.domElements.modelError.style.display = 'none'
      this.domElements.mainContent.style.display = 'block'
    }
  }

  setupEventListeners() {
    // Start tracking button
    this.domElements.startButton?.addEventListener('click', () => this.startTracking())

    // Stop tracking button
    this.domElements.stopButton?.addEventListener('click', () => this.stopTracking())

    // Export sessions button
    this.domElements.exportButton?.addEventListener('click', () => this.exportSessions())

    // Import sessions input
    this.domElements.importInput?.addEventListener('change', (e) => this.importSessions(e))
  }

  updateSessionsList() {
    const sessionsList = this.domElements.sessionsList
    if (!sessionsList) return

    if (this.savedSessions.length === 0) {
      sessionsList.innerHTML = `<div class="empty-state">No recent focus sessions found</div>`
      return
    }

    // Sort sessions by date, newest first
    const sortedSessions = [...this.savedSessions].sort(
      (a, b) =>
        new Date(b.startTime || b.createdAt || 0) - new Date(a.startTime || a.createdAt || 0)
    )

    // Take only the 5 most recent sessions
    const recentSessions = sortedSessions.slice(0, 5)

    sessionsList.innerHTML = recentSessions
      .map((session) => {
        const startTime = new Date(session.startTime)
        const endTime = session.endTime ? new Date(session.endTime) : new Date()
        const duration = Math.floor((endTime - startTime) / 1000 / 60) // Duration in minutes
        const formattedDate = startTime.toLocaleDateString()
        const formattedTime = startTime.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit'
        })

        return `
        <div class="session-item">
          <div class="session-date">${formattedDate}, ${formattedTime}</div>
          <div class="session-details">
            <div class="session-duration">${duration} min</div>
            <div class="session-focus">Score: ${Math.round(session.attentionScore)}</div>
          </div>
        </div>
      `
      })
      .join('')
  }

  async startTracking() {
    if (this.isTracking) return

    try {
      // Request camera access
      await this.initializeCamera()

      // Reset focus data
      this.focusData = this.resetFocusData()
      this.focusData.startTime = Date.now()

      // Update UI
      this.domElements.startButton.disabled = true
      this.domElements.stopButton.disabled = false
      if (this.domElements.faceIndicator) {
        this.domElements.faceIndicator.classList.remove('face-detected', 'no-face-detected')
      }
      this.isTracking = true

      // Start tracking loop
      this.trackingInterval = setInterval(() => this.trackFocus(), 200)

      // Start session timer
      this.timerInterval = setInterval(() => this.updateSessionTime(), 1000)

      console.log('Focus tracking started')
    } catch (error) {
      console.error('Failed to start focus tracking:', error)
      this.showError(`Failed to start tracking: ${error.message}`)
    }
  }

  async initializeCamera() {
    try {
      const constraints = {
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 }
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      this.videoElement.srcObject = stream

      // Wait for video to be ready
      return new Promise((resolve) => {
        this.videoElement.onloadedmetadata = () => {
          this.videoElement.play()
          resolve(true)
        }
      })
    } catch (error) {
      console.error('Failed to initialize camera:', error)
      throw error
    }
  }

  stopCamera() {
    if (this.videoElement && this.videoElement.srcObject) {
      const tracks = this.videoElement.srcObject.getTracks()
      tracks.forEach((track) => track.stop())
      this.videoElement.srcObject = null
    }
  }

  stopTracking() {
    if (!this.isTracking) return

    // Stop video stream
    this.stopCamera()

    // Stop intervals
    clearInterval(this.trackingInterval)
    clearInterval(this.timerInterval)

    // Update focus data
    this.focusData.endTime = Date.now()
    this.focusData.sessionDuration = (this.focusData.endTime - this.focusData.startTime) / 1000 // in seconds

    // Update UI
    this.domElements.startButton.disabled = false
    this.domElements.stopButton.disabled = true
    this.isTracking = false

    // Clear canvas
    if (this.canvasContext) {
      this.canvasContext.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height)
    }

    // Save session data
    this.saveSession()

    // Final update
    this.updateStats()

    console.log('Focus tracking stopped')

    return this.focusData
  }

  saveSession() {
    // Only save sessions that lasted at least 30 seconds
    if (this.focusData.sessionDuration >= 30) {
      const sessionToSave = {
        ...this.focusData,
        id: Date.now(),
        createdAt: new Date().toISOString()
      }

      this.savedSessions.push(sessionToSave)

      // Keep only the 50 most recent sessions
      if (this.savedSessions.length > 50) {
        this.savedSessions = this.savedSessions
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          .slice(0, 50)
      }

      // Save to localStorage
      this.saveSessions()
    }

    // Update session list
    this.updateSessionsList()
  }

  async trackFocus() {
    if (!this.isTracking || !this.modelLoaded || !faceDetector) return

    try {
      // Detect faces
      if (!this.videoElement || this.videoElement.readyState < 2) {
        return
      }

      const faces = await faceDetector.estimateFaces(this.videoElement)
      const faceDetected = faces && faces.length > 0

      // Update face detection indicator
      this.updateFaceIndicator(faceDetected)

      if (faceDetected) {
        // Draw face on canvas
        this.drawFaceLandmarks(faces[0])

        // Record face detection
        this.focusData.faceDetections.push({
          timestamp: Date.now()
        })

        // Estimate eye openness and blink detection
        const blinkData = this.estimateBlinkFromFace(faces[0])

        // Record blink event if blinking
        if (blinkData.isBlinking) {
          this.focusData.blinkEvents.push({
            timestamp: Date.now(),
            eyeOpenness: blinkData.eyeOpenness
          })
        }

        // Calculate blink rate (blinks per minute)
        const sessionDurationMinutes = (Date.now() - this.focusData.startTime) / 60000
        this.focusData.blinkRate =
          this.focusData.blinkEvents.length / Math.max(sessionDurationMinutes, 0.1)

        // Update attention score based on blink rate
        this.updateAttentionScore(blinkData.eyeOpenness, blinkData.isBlinking)
      } else {
        // No face detected - record distraction
        this.recordDistraction()

        // Clear canvas when no face is detected
        if (this.canvasContext) {
          this.canvasContext.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height)
        }
      }

      // Update stats display
      this.updateStats()
    } catch (error) {
      console.error('Error during focus tracking:', error)
    }
  }

  estimateBlinkFromFace(face) {
    // Default values
    let isBlinking = false
    let eyeOpenness = 1.0

    // BlazeFace may not provide detailed eye landmarks
    // We'll approximate using the face topology and probability

    // If probability is low, consider it a blink (face not fully visible/looking away)
    if (face.box && face.box.probability) {
      // Low probability may indicate looking away or eyes closed
      if (face.box.probability < 0.85) {
        isBlinking = true
        eyeOpenness = face.box.probability * 0.5
      }
    }

    return { isBlinking, eyeOpenness }
  }

  drawFaceLandmarks(face) {
    if (!this.canvasContext || !face) return

    // Clear canvas
    this.canvasContext.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height)

    // Draw bounding box if available
    if (face.box) {
      const box = face.box
      this.canvasContext.strokeStyle = '#00ff00'
      this.canvasContext.lineWidth = 2

      // Check if the box uses xMin,yMin format or x,y,width,height format
      if ('xMin' in box && 'yMin' in box && 'width' in box && 'height' in box) {
        this.canvasContext.strokeRect(box.xMin, box.yMin, box.width, box.height)
      } else if ('x' in box && 'y' in box && 'width' in box && 'height' in box) {
        this.canvasContext.strokeRect(box.x, box.y, box.width, box.height)
      }
    }

    // Draw keypoints if available
    if (face.keypoints && face.keypoints.length > 0) {
      face.keypoints.forEach((keypoint) => {
        this.canvasContext.fillStyle = '#00ffff'
        this.canvasContext.beginPath()
        this.canvasContext.arc(keypoint.x, keypoint.y, 3, 0, 2 * Math.PI)
        this.canvasContext.fill()
      })
    }
  }

  updateAttentionScore(eyeOpenness, isBlinking) {
    // Current attention score
    let score = this.focusData.attentionScore

    // Factors affecting attention score
    if (!isBlinking) {
      // Normal eye state - gradually increase score if in healthy blink rate range
      if (this.focusData.blinkRate >= 10 && this.focusData.blinkRate <= 25) {
        // Healthy blink rate (10-25 blinks per minute)
        score = Math.min(score + 0.2, 100)
      } else if (this.focusData.blinkRate < 10) {
        // Too few blinks - potential staring, slight decrease
        score = Math.max(score - 0.1, 40)
      } else if (this.focusData.blinkRate > 25) {
        // Too many blinks - potential fatigue
        score = Math.max(score - 0.2, 20)
      }
    }

    // Record score in history
    this.focusData.focusScoreHistory.push({
      timestamp: Date.now(),
      score: score
    })

    // Update score
    this.focusData.attentionScore = score
  }

  recordDistraction() {
    // Only count as distraction if we previously detected a face
    if (this.focusData.faceDetections.length > 0) {
      const lastDetection = this.focusData.faceDetections[this.focusData.faceDetections.length - 1]
      const timeSinceLastDetection = Date.now() - lastDetection.timestamp

      // If face was detected recently (within 2 seconds) but now gone, count as distraction
      if (timeSinceLastDetection < 2000) {
        this.focusData.distractions++

        // Reduce attention score for distraction
        this.focusData.attentionScore = Math.max(this.focusData.attentionScore - 5, 0)

        // Record score in history
        this.focusData.focusScoreHistory.push({
          timestamp: Date.now(),
          score: this.focusData.attentionScore
        })
      }
    }
  }

  updateFaceIndicator(faceDetected) {
    if (!this.domElements.faceIndicator) return

    this.domElements.faceIndicator.classList.remove('face-detected', 'no-face-detected')
    this.domElements.faceIndicator.classList.add(
      faceDetected ? 'face-detected' : 'no-face-detected'
    )
  }

  updateStats() {
    // Update focus score
    if (this.domElements.focusScore) {
      this.domElements.focusScore.textContent = Math.round(this.focusData.attentionScore)
    }

    // Update blink rate
    if (this.domElements.blinkRate) {
      this.domElements.blinkRate.textContent = Math.round(this.focusData.blinkRate)
    }

    // Update distraction count
    if (this.domElements.distractionCount) {
      this.domElements.distractionCount.textContent = this.focusData.distractions
    }
  }

  updateSessionTime() {
    if (!this.domElements.sessionTime) return

    const sessionDurationSeconds = Math.floor((Date.now() - this.focusData.startTime) / 1000)
    const minutes = Math.floor(sessionDurationSeconds / 60)
      .toString()
      .padStart(2, '0')
    const seconds = (sessionDurationSeconds % 60).toString().padStart(2, '0')
    this.domElements.sessionTime.textContent = `${minutes}:${seconds}`
  }

  exportSessions() {
    if (this.savedSessions.length === 0) {
      this.showError('No focus sessions to export')
      return
    }

    const dataStr = JSON.stringify(this.savedSessions, null, 2)
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr)

    const exportFileDefaultName = `focus-sessions-${new Date().toISOString().slice(0, 10)}.json`

    const linkElement = document.createElement('a')
    linkElement.setAttribute('href', dataUri)
    linkElement.setAttribute('download', exportFileDefaultName)
    linkElement.style.display = 'none'
    document.body.appendChild(linkElement) // Required for Firefox

    linkElement.click()

    document.body.removeChild(linkElement)
  }

  importSessions(fileInputEvent) {
    try {
      const file = fileInputEvent.target.files[0]
      if (!file) {
        return
      }

      const reader = new FileReader()

      reader.onload = (event) => {
        try {
          const importedSessions = JSON.parse(event.target.result)

          if (!Array.isArray(importedSessions)) {
            throw new Error('Invalid format: imported data is not an array')
          }

          const validSessions = importedSessions.filter((session) => {
            return (
              session.startTime &&
              (session.endTime || session.sessionDuration) &&
              typeof session.attentionScore === 'number'
            )
          })

          if (validSessions.length === 0) {
            throw new Error('No valid focus sessions found in the imported file')
          }

          // Merge with existing sessions, avoiding duplicates by ID
          const existingIds = new Set(this.savedSessions.map((s) => s.id))

          this.savedSessions = [
            ...this.savedSessions,
            ...validSessions.filter((s) => !existingIds.has(s.id))
          ]

          // Sort and limit to 50 sessions
          this.savedSessions = this.savedSessions
            .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
            .slice(0, 50)

          this.saveSessions()
          this.updateSessionsList()

          this.showNotification(`Successfully imported ${validSessions.length} focus sessions`)
        } catch (error) {
          console.error('Error parsing imported file:', error)
          this.showError(`Error importing focus sessions: ${error.message}`)
        }
      }

      reader.onerror = () => {
        this.showError('Error reading the file')
      }

      reader.readAsText(file)
    } catch (error) {
      console.error('Error importing focus sessions:', error)
      this.showError(`Error importing focus sessions: ${error.message}`)
    }
  }

  showError(message) {
    if (!this.domElements.errorContainer) return

    this.domElements.errorContainer.textContent = message
    this.domElements.errorContainer.style.display = 'block'

    setTimeout(() => {
      this.domElements.errorContainer.style.display = 'none'
    }, 5000)
  }

  showNotification(message) {
    const notification = document.createElement('div')
    notification.className = 'notification'
    notification.textContent = message

    document.body.appendChild(notification)

    setTimeout(() => {
      notification.classList.add('show')
    }, 10)

    setTimeout(() => {
      notification.classList.remove('show')
      setTimeout(() => {
        document.body.removeChild(notification)
      }, 300)
    }, 3000)
  }
}

function updateDashboardWithFocusData(sessions) {
  if (!sessions || sessions.length === 0) return

  // Calculate total study time (in hours)
  const totalStudyTimeHours = sessions.reduce((total, session) => {
    const duration = session.sessionDuration || (session.endTime - session.startTime) / 1000 / 3600
    return total + duration
  }, 0)

  // Calculate average focus score
  const avgFocusScore =
    sessions.reduce((total, session) => total + session.attentionScore, 0) / sessions.length

  // Find completed modules (sessions with score > 70)
  const completedModules = sessions.filter((session) => session.attentionScore > 70).length

  // Update dashboard UI if elements exist
  const studyTimeElement = document.querySelector('.stat-card:nth-child(1) .stat-value')
  const avgFocusElement = document.querySelector('.stat-card:nth-child(2) .stat-value')
  const modulesElement = document.querySelector('.stat-card:nth-child(3) .stat-value')

  if (studyTimeElement) {
    studyTimeElement.textContent = `${totalStudyTimeHours.toFixed(1)}h`
  }

  if (avgFocusElement) {
    avgFocusElement.textContent = `${Math.round(avgFocusScore)}%`
  }

  if (modulesElement) {
    modulesElement.textContent = completedModules.toString()
  }

  // Update recent sessions list in dashboard
  updateRecentSessionsList(sessions)
}

// Update recent sessions list in dashboard
function updateRecentSessionsList(sessions) {
  const recentSessionsList = document.querySelector('.sessions-list')
  if (!recentSessionsList) return

  if (sessions.length === 0) {
    recentSessionsList.innerHTML = `
      <p class="empty-state">
        No recent study sessions found. Start tracking your focus to see data here.
      </p>
    `
    return
  }

  // Sort sessions by date, newest first
  const sortedSessions = [...sessions].sort(
    (a, b) => new Date(b.startTime || b.createdAt || 0) - new Date(a.startTime || a.createdAt || 0)
  )

  // Take the 5 most recent sessions
  const recentSessions = sortedSessions.slice(0, 5)

  recentSessionsList.innerHTML = recentSessions
    .map((session) => {
      const startTime = new Date(session.startTime)
      const formattedDate = startTime.toLocaleDateString()
      const formattedTime = startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      const duration = Math.round((session.endTime - session.startTime) / 1000 / 60) // Duration in minutes

      return `
      <div class="session-item">
        <div class="session-date">
          <span class="material-icons">event</span>
          ${formattedDate}, ${formattedTime}
        </div>
        <div class="session-details">
          <div class="session-duration">
            <span class="material-icons">timer</span>
            ${duration} min
          </div>
          <div class="session-focus">
            <span class="material-icons">psychology</span>
            Score: ${Math.round(session.attentionScore)}%
          </div>
        </div>
      </div>
    `
    })
    .join('')
}

// Update focus chart with session data
function updateFocusChart(sessions) {
  const chartElement = document.getElementById('focus-chart')
  if (!chartElement) return

  try {
    // Only use sessions from the last 7 days
    const oneWeekAgo = new Date()
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7)

    const recentSessions = sessions.filter((session) => new Date(session.startTime) >= oneWeekAgo)

    // If no recent sessions, show placeholder chart
    if (recentSessions.length === 0) {
      createPlaceholderChart(chartElement)
      return
    }

    // Group sessions by day
    const sessionsByDay = {}
    const dayLabels = []

    // Initialize the last 7 days
    for (let i = 6; i >= 0; i--) {
      const date = new Date()
      date.setDate(date.getDate() - i)
      const dayKey = date.toISOString().slice(0, 10)
      const dayName = date.toLocaleDateString('en-US', { weekday: 'short' })

      sessionsByDay[dayKey] = {
        scores: [],
        day: dayName,
        date: dayKey
      }

      dayLabels.push(dayName)
    }

    // Add sessions to their respective days
    recentSessions.forEach((session) => {
      const date = new Date(session.startTime)
      const dayKey = date.toISOString().slice(0, 10)

      if (sessionsByDay[dayKey]) {
        sessionsByDay[dayKey].scores.push(session.attentionScore)
      }
    })

    // Calculate average scores for each day
    const currentWeekData = []
    const previousWeekData = []

    Object.keys(sessionsByDay).forEach((day) => {
      const scores = sessionsByDay[day].scores

      // Current week data
      if (scores.length > 0) {
        const avgScore = scores.reduce((sum, score) => sum + score, 0) / scores.length
        currentWeekData.push(Math.round(avgScore))
      } else {
        currentWeekData.push(null) // No data for this day
      }

      // Previous week data (placeholder - would need actual previous week data)
      previousWeekData.push(Math.random() * 30 + 60) // Random value between 60-90
    })

    // Create SVG chart
    createFocusChart(chartElement, dayLabels, currentWeekData, previousWeekData)
  } catch (error) {
    console.error('Error updating focus chart:', error)
    createPlaceholderChart(chartElement)
  }
}

// Create focus chart with real data
function createFocusChart(chartElement, labels, currentData, previousData) {
  const width = 800
  const height = 300
  const padding = { top: 30, right: 20, bottom: 40, left: 40 }

  if (!chartElement || !labels || !currentData || !previousData) {
    console.error('Missing required parameters for createFocusChart')
    createPlaceholderChart(chartElement || document.getElementById('focus-chart'))
    return
  }

  // Determine max value for scaling
  const maxValue = Math.max(
    ...currentData.filter((v) => v !== null),
    ...previousData.filter((v) => v !== null)
  )

  // Create SVG element
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '100%')
  svg.setAttribute('height', '100%')
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)

  // Add grid lines
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + (height - padding.top - padding.bottom) * (i / 4)
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    line.setAttribute('x1', padding.left)
    line.setAttribute('y1', y)
    line.setAttribute('x2', width - padding.right)
    line.setAttribute('y2', y)
    line.setAttribute('stroke', 'rgba(255,255,255,0.1)')
    line.setAttribute('stroke-width', '1')
    svg.appendChild(line)

    // Add Y-axis labels
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    label.setAttribute('x', padding.left - 10)
    label.setAttribute('y', y + 5)
    label.setAttribute('text-anchor', 'end')
    label.setAttribute('fill', '#b0b7c3')
    label.setAttribute('font-size', '12')
    label.textContent = `${Math.round(maxValue * (1 - i / 4))}`
    svg.appendChild(label)
  }

  // Create current week line path
  let currentPath = `M${padding.left},${padding.top + height - padding.top - padding.bottom}`
  let validPoints = 0

  currentData.forEach((value, index) => {
    if (value !== null) {
      const x =
        padding.left + (width - padding.left - padding.right) * (index / (labels.length - 1))
      const y = padding.top + (height - padding.top - padding.bottom) * (1 - value / maxValue)

      if (validPoints === 0) {
        currentPath = `M${x},${y}`
      } else {
        currentPath += ` L${x},${y}`
      }

      validPoints++
    }
  })

  // If we have at least two points, add the path
  if (validPoints >= 2) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', currentPath)
    path.setAttribute('fill', 'none')
    path.setAttribute('stroke', '#3366ff')
    path.setAttribute('stroke-width', '3')
    svg.appendChild(path)
  }

  // Create previous week line path
  let prevPath = ''
  validPoints = 0

  previousData.forEach((value, index) => {
    const x = padding.left + (width - padding.left - padding.right) * (index / (labels.length - 1))
    const y = padding.top + (height - padding.top - padding.bottom) * (1 - value / maxValue)

    if (validPoints === 0) {
      prevPath = `M${x},${y}`
    } else {
      prevPath += ` L${x},${y}`
    }

    validPoints++
  })

  // Add previous week path with dashed line
  if (validPoints >= 2) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', prevPath)
    path.setAttribute('fill', 'none')
    path.setAttribute('stroke', '#ff9966')
    path.setAttribute('stroke-width', '3')
    path.setAttribute('stroke-dasharray', '5,5')
    svg.appendChild(path)
  }

  // Add X-axis labels
  labels.forEach((label, index) => {
    const x = padding.left + (width - padding.left - padding.right) * (index / (labels.length - 1))
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    text.setAttribute('x', x)
    text.setAttribute('y', height - 10)
    text.setAttribute('text-anchor', 'middle')
    text.setAttribute('fill', '#b0b7c3')
    text.setAttribute('font-size', '12')
    text.textContent = label
    svg.appendChild(text)
  })

  // Add legend
  const legend1 = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
  legend1.setAttribute('cx', width - 150)
  legend1.setAttribute('cy', 20)
  legend1.setAttribute('r', 5)
  legend1.setAttribute('fill', '#3366ff')
  svg.appendChild(legend1)

  const legend1Text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
  legend1Text.setAttribute('x', width - 140)
  legend1Text.setAttribute('y', 25)
  legend1Text.setAttribute('fill', '#ffffff')
  legend1Text.setAttribute('font-size', '12')
  legend1Text.textContent = 'This week'
  svg.appendChild(legend1Text)

  const legend2 = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
  legend2.setAttribute('cx', width - 60)
  legend2.setAttribute('cy', 20)
  legend2.setAttribute('r', 5)
  legend2.setAttribute('fill', '#ff9966')
  svg.appendChild(legend2)

  const legend2Text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
  legend2Text.setAttribute('x', width - 50)
  legend2Text.setAttribute('y', 25)
  legend2Text.setAttribute('fill', '#ffffff')
  legend2Text.setAttribute('font-size', '12')
  legend2Text.textContent = 'Last week'
  svg.appendChild(legend2Text)

  // Clear and append the SVG
  chartElement.innerHTML = ''
  chartElement.appendChild(svg)
}

// Create placeholder chart when no data is available
function createPlaceholderChart(chartElement) {
  const chartHTML = `
    <div class="chart-placeholder">
      <svg width="100%" height="100%" viewBox="0 0 800 300">
        <!-- Chart grid -->
        <line x1="0" y1="250" x2="800" y2="250" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
        <line x1="0" y1="200" x2="800" y2="200" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
        <line x1="0" y1="150" x2="800" y2="150" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
        <line x1="0" y1="100" x2="800" y2="100" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
        <line x1="0" y1="50" x2="800" y2="50" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
        
        <!-- Chart data - Focus level line -->
        <path d="M0,200 Q100,180 200,150 T400,100 T600,170 T800,120" fill="none" stroke="#3366ff" stroke-width="3"/>
        
        <!-- Chart data - Previous period line -->
        <path d="M0,180 Q100,200 200,220 T400,150 T600,190 T800,170" fill="none" stroke="#ff9966" stroke-width="3" stroke-dasharray="5,5"/>
        
        <!-- X-axis labels -->
        <text x="0" y="270" fill="#b0b7c3" font-size="12">Mon</text>
        <text x="133" y="270" fill="#b0b7c3" font-size="12">Tue</text>
        <text x="266" y="270" fill="#b0b7c3" font-size="12">Wed</text>
        <text x="399" y="270" fill="#b0b7c3" font-size="12">Thu</text>
        <text x="532" y="270" fill="#b0b7c3" font-size="12">Fri</text>
        <text x="665" y="270" fill="#b0b7c3" font-size="12">Sat</text>
        <text x="798" y="270" fill="#b0b7c3" font-size="12">Sun</text>
        
        <!-- Legend -->
        <circle cx="650" cy="20" r="5" fill="#3366ff"/>
        <text x="660" y="25" fill="#ffffff" font-size="12">This week</text>
        <circle cx="740" cy="20" r="5" fill="#ff9966"/>
        <text x="750" y="25" fill="#ffffff" font-size="12">Last week</text>
      </svg>
    </div>
  `

  chartElement.innerHTML = chartHTML
}

// Main function to initialize focus tracking
async function initializeFocusTracking() {
  const focusContainer = document.getElementById('focus-tracking-container')
  if (!focusContainer) {
    console.error('Focus tracking container not found')
    return
  }

  // Create focus tracker if not exists
  if (!window.focusTracker) {
    window.focusTracker = new FocusTracker()
    await window.focusTracker.initialize(focusContainer)
  }
}

// Load focus sessions from local storage and update the dashboard
function loadAndUpdateFocusSessions() {
  try {
    const savedSessions = localStorage.getItem('focusSessions')
    if (savedSessions) {
      const sessions = JSON.parse(savedSessions)
      console.log(`Loaded ${sessions.length} focus sessions from storage`)

      // Update dashboard with loaded sessions
      updateDashboardWithFocusData(sessions)
      return sessions
    }
  } catch (error) {
    console.error('Error loading focus sessions:', error)
  }
  return []
}

// Export focus sessions to a JSON file

// Import focus sessions from a JSON file

// Initialize focus tracker instance
let focusTracker = null

// Update recent sessions list in dashboard

// Enhanced curriculum generation using TensorFlow
async function createCurriculumModel() {
  // Create a simple model for prioritizing assignments
  const model = tf.sequential()

  model.add(
    tf.layers.dense({
      units: 10,
      activation: 'relu',
      inputShape: [5] // Complexity, time required, due date, etc.
    })
  )

  model.add(
    tf.layers.dense({
      units: 5,
      activation: 'relu'
    })
  )

  model.add(
    tf.layers.dense({
      units: 1,
      activation: 'sigmoid' // Priority score between 0 and 1
    })
  )

  model.compile({
    optimizer: tf.train.adam(0.01),
    loss: 'binaryCrossentropy',
    metrics: ['accuracy']
  })

  return model
}

// Extract features from course data for AI-based curriculum generation
function extractFeaturesFromCourseData(courses) {
  return courses.reduce((allFeatures, course) => {
    if (!course.courseWork || course.courseWork.length === 0) {
      return allFeatures
    }

    const courseFeatures = course.courseWork.map((work) => {
      // Calculate assignment complexity based on description length, title, etc.
      const complexityScore = calculateAssignmentComplexity(work)

      // Calculate estimated time required
      const timeRequired = estimateTimeRequired(work)

      // Calculate due window (days until due)
      const dueWindow = calculateDueWindow(work)

      // Calculate priority level
      const priorityLevel = calculatePriorityLevel(work, complexityScore, dueWindow)

      return {
        courseId: course.id,
        courseName: course.name,
        workId: work.id,
        workTitle: work.title,
        workType: work.workType || 'ASSIGNMENT',
        assignmentComplexity: complexityScore,
        timeRequired,
        dueWindow,
        priorityLevel,
        dueDate: work.dueDate ? createDateFromDueDate(work.dueDate) : null,
        originalWork: work
      }
    })

    return [...allFeatures, ...courseFeatures]
  }, [])
}

// Calculate assignment complexity score
function calculateAssignmentComplexity(work) {
  let complexity = 0

  // Base complexity by work type
  switch (work.workType) {
    case 'ASSIGNMENT':
      complexity = 3
      break
    case 'SHORT_ANSWER_QUESTION':
      complexity = 2
      break
    case 'MULTIPLE_CHOICE_QUESTION':
      complexity = 1
      break
    case 'QUIZ':
      complexity = 4
      break
    case 'TEST':
      complexity = 5
      break
    default:
      complexity = 2
  }

  // Add complexity based on description length if available
  if (work.description) {
    // Longer descriptions usually mean more complex assignments
    complexity += Math.min(work.description.length / 200, 3)
  }

  // Normalize to 0-1 range
  return Math.min(complexity / 10, 1)
}

// Estimate time required for assignment
function estimateTimeRequired(work) {
  let baseTime = 0 // in hours

  // Base time by work type
  switch (work.workType) {
    case 'ASSIGNMENT':
      baseTime = 1.5
      break
    case 'SHORT_ANSWER_QUESTION':
      baseTime = 0.5
      break
    case 'MULTIPLE_CHOICE_QUESTION':
      baseTime = 0.25
      break
    case 'QUIZ':
      baseTime = 1
      break
    case 'TEST':
      baseTime = 2
      break
    default:
      baseTime = 1
  }

  // Adjust based on description length
  if (work.description) {
    baseTime += Math.min(work.description.length / 500, 1)
  }

  // Normalize to 0-1 range (assuming max 5 hours)
  return Math.min(baseTime / 5, 1)
}

// Calculate due window (days until due)
function calculateDueWindow(work) {
  if (!work.dueDate) {
    return 1 // Far in the future if no due date
  }

  const today = new Date()
  const dueDate = createDateFromDueDate(work.dueDate)
  const diffTime = dueDate - today
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

  // Normalize to 0-1 range (0 = due today, 1 = due in 14+ days)
  return Math.max(0, Math.min(diffDays / 14, 1))
}

// Calculate priority level
function calculatePriorityLevel(work, complexity, dueWindow) {
  // Priority increases with complexity and decreases with due window
  // Due window has more weight (urgent items are higher priority)
  return complexity * 0.3 + (1 - dueWindow) * 0.7
}

// Generate smart curriculum using TensorFlow model
async function generateSmartCurriculum(coursesData, userPreferences = {}) {
  try {
    // Extract features from course data
    const features = extractFeaturesFromCourseData(coursesData)

    if (features.length === 0) {
      return { success: false, message: 'No course work available to generate curriculum' }
    }

    // Set default preferences if not provided
    const preferences = {
      preferredDifficulty: 0.5, // Medium difficulty
      availableHoursPerWeek: 10, // Default 10 hours/week
      prioritizeDeadlines: true,
      ...userPreferences
    }

    // Load TensorFlow.js if not already loaded
    if (!window.tf) {
      await import('@tensorflow/tfjs')
    }

    // Create or load the model
    const model = await createCurriculumModel()

    // Calculate optimal study plan
    const studyPlan = optimizeStudyPlan(features, preferences)

    // Create a weekly schedule
    const weeklySchedule = createWeeklySchedule(studyPlan, coursesData)

    return {
      success: true,
      weeklySchedule,
      totalAssignments: features.length,
      totalEstimatedHours: calculateTotalHours(studyPlan),
      courseBreakdown: calculateCourseBreakdown(studyPlan)
    }
  } catch (error) {
    console.error('Error generating smart curriculum:', error)
    return {
      success: false,
      message: `Failed to generate curriculum: ${error.message}`
    }
  }
}

// Optimize study plan based on features and preferences
function optimizeStudyPlan(features, preferences) {
  // Sort features by priority
  let sortedFeatures = [...features]

  if (preferences.prioritizeDeadlines) {
    // Prioritize by due date first, then by complexity
    sortedFeatures.sort((a, b) => {
      // If both have due dates, sort by due date
      if (a.dueDate && b.dueDate) {
        return a.dueDate - b.dueDate
      }
      // If only one has a due date, prioritize it
      if (a.dueDate) return -1
      if (b.dueDate) return 1

      // If neither has a due date, sort by complexity based on preference
      if (preferences.preferredDifficulty >= 0.5) {
        // Prefer more complex assignments
        return b.assignmentComplexity - a.assignmentComplexity
      } else {
        // Prefer less complex assignments
        return a.assignmentComplexity - b.assignmentComplexity
      }
    })
  } else {
    // Sort by calculated priority level
    sortedFeatures.sort((a, b) => b.priorityLevel - a.priorityLevel)
  }

  return sortedFeatures
}

// Create weekly schedule from optimized study plan
function createWeeklySchedule(studyPlan, originalCourseData) {
  const weeklySchedule = []
  const daysOfWeek = 7

  // Initialize schedule for 4 weeks
  for (let week = 0; week < 4; week++) {
    const weekStart = new Date()
    weekStart.setDate(weekStart.getDate() + week * 7)

    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 6)

    weeklySchedule.push({
      week: week + 1,
      startDate: weekStart,
      endDate: weekEnd,
      days: []
    })

    // Initialize days for the week
    for (let day = 0; day < daysOfWeek; day++) {
      const dayDate = new Date(weekStart)
      dayDate.setDate(dayDate.getDate() + day)

      weeklySchedule[week].days.push({
        day,
        date: dayDate,
        assignments: []
      })
    }
  }

  // Distribute assignments across the schedule
  let currentWeek = 0
  let currentDay = 0
  let currentDayHours = 0
  const maxHoursPerDay = 3 // Configurable

  studyPlan.forEach((assignment) => {
    const estimatedHours = assignment.timeRequired * 5 // Convert from normalized value

    // Check if we need to move to the next day
    if (currentDayHours + estimatedHours > maxHoursPerDay) {
      currentDay = (currentDay + 1) % daysOfWeek
      currentDayHours = 0

      // Check if we need to move to the next week
      if (currentDay === 0) {
        currentWeek = (currentWeek + 1) % 4
      }
    }

    // Add assignment to the schedule
    weeklySchedule[currentWeek].days[currentDay].assignments.push({
      id: assignment.workId,
      title: assignment.workTitle,
      courseId: assignment.courseId,
      courseName: assignment.courseName,
      estimatedHours,
      dueDate: assignment.dueDate,
      type: assignment.workType,
      complexity: assignment.assignmentComplexity
    })

    // Update current day hours
    currentDayHours += estimatedHours
  })

  return weeklySchedule
}

// Calculate total estimated hours for the curriculum
function calculateTotalHours(studyPlan) {
  return studyPlan.reduce((total, assignment) => {
    return total + assignment.timeRequired * 5 // Convert from normalized value
  }, 0)
}

// Calculate course breakdown for the curriculum
function calculateCourseBreakdown(studyPlan) {
  const courseData = {}

  studyPlan.forEach((assignment) => {
    if (!courseData[assignment.courseName]) {
      courseData[assignment.courseName] = {
        assignmentCount: 0,
        totalHours: 0
      }
    }

    courseData[assignment.courseName].assignmentCount++
    courseData[assignment.courseName].totalHours += assignment.timeRequired * 5
  })

  return Object.entries(courseData).map(([courseName, data]) => ({
    courseName,
    assignmentCount: data.assignmentCount,
    totalHours: data.totalHours
  }))
}

// Initialize the application
async function initApp() {
  console.log('Initializing application...')

  try {
    // Check for redirect result first
    console.log('Checking for auth redirect result')
    const redirectUser = await handleRedirectResult()
    if (redirectUser) {
      console.log('User authenticated via redirect')
    }

    function initFocusTracking() {
      // Load and update sessions on startup
      loadAndUpdateFocusSessions()

      // Add event listeners for import/export buttons
      document.getElementById('export-sessions')?.addEventListener('click', exportFocusSessions)
      document.getElementById('import-sessions')?.addEventListener('change', importFocusSessions)

      // Focus section integration
      document.querySelector('[data-section="focus"]')?.addEventListener('click', () => {
        // Initialize focus tracking when navigating to the focus section
        initializeFocusTracking()
      })
    }

    // Initialize theme
    themeManager.initialize()

    // Load focus sessions
    loadFocusSessions()

    // Initialize UI elements
    createFocusChart()
    initNavigation()
    initSettings()
    initWindowControls()
    setupCheckboxListeners()

    // Initialize auth listeners
    initializeAuthUI()

    // Debug token status
    const token = localStorage.getItem('googleClassroomToken')
    console.log('Token exists on startup:', !!token)

    if (token) {
      try {
        // Verify token is still valid
        await classroomService.testToken()
        console.log('Token is valid')
      } catch (error) {
        console.warn('Token validation failed:', error.message)
        // Don't remove the token here, let the API call handle that
      }
    }

    // Update dashboard with focus session data
    const sessions = loadFocusSessions()
    updateDashboardWithFocusData(sessions)
  } catch (error) {
    console.error('Error during app initialization:', error)
  }
}

async function testClassroomAPI() {
  const token = localStorage.getItem('googleClassroomToken')
  if (!token) {
    console.log('No token available for Classroom API test')
    return
  }

  console.log('Testing Classroom API with token')
  try {
    const response = await fetch(
      'https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE',
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    )

    if (!response.ok) {
      console.error('Classroom API test failed with status:', response.status)
      const errorText = await response.text()
      console.error('Error response:', errorText)

      // If token is invalid, remove it
      if (response.status === 401) {
        console.log('Token appears to be invalid or expired, removing it')
        localStorage.removeItem('googleClassroomToken')
        // Optionally notify the user they need to sign in again
        updateUI(null) // Update UI to show user is not logged in
      }

      return
    }

    const data = await response.json()
    console.log('Classroom API test successful, courses:', data)
  } catch (error) {
    console.error('Classroom API test error:', error)
  }
}

// Set up Firebase auth state listener
if (auth) {
  onAuthStateChanged(auth, (user) => {
    console.log('Auth state changed:', user ? 'User signed in' : 'User signed out')

    // Update authService state
    authService.user = user

    // Check token status whenever auth state changes
    if (user) {
      console.log('User signed in, checking token')
      const token = localStorage.getItem('googleClassroomToken')
      console.log('Token in localStorage:', !!token)

      if (!token) {
        console.warn('User is signed in but no token is available')
        // May need to re-authenticate in this case
      } else {
        testClassroomAPI()
      }
    }

    // Update UI
    updateUI(user)

    // Notify auth listeners
    authService.notifyListeners()
  })
}

function initializeAuthUI() {
  const userSection = document.getElementById('user-section')
  const userAvatar = document.getElementById('user-avatar')
  const userName = document.getElementById('user-name')
  const loginButton = document.getElementById('login-button')
  const logoutButton = document.getElementById('logout-button')
  const curriculumLoginButton = document.getElementById('curriculum-login-button')

  console.log('Auth elements:', {
    userSection: !!userSection,
    userAvatar: !!userAvatar,
    userName: !!userName,
    loginButton: !!loginButton,
    logoutButton: !!logoutButton,
    curriculumLoginButton: !!curriculumLoginButton
  })

  // Handle login clicks
  if (loginButton) {
    loginButton.addEventListener('click', () => {
      console.log('Login button clicked')
      showAccountSelectionModal() // Just show the modal, don't call login directly
    })
  }

  if (curriculumLoginButton) {
    curriculumLoginButton.addEventListener('click', () => {
      console.log('Curriculum login button clicked')
      showAccountSelectionModal() // Just show the modal, don't call login directly
    })
  }

  // Handle logout
  if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
      console.log('Logout button clicked')
      try {
        await authService.logout()
      } catch (error) {
        console.error('Logout failed:', error)
        alert(`Logout failed: ${error.message}`)
      }
    })
  }
}

// Load curriculum data from Google Classroom
async function loadCurriculumData() {
  if (!authService.isLoggedIn()) {
    console.log('Not logged in, cannot load curriculum data')
    return
  }

  const token = localStorage.getItem('googleClassroomToken')
  if (!token) {
    console.error('No access token found. Please sign in again.')
    return
  }

  const loadingIndicator = document.getElementById('curriculum-loading')
  const curriculumContent = document.getElementById('curriculum-content')
  const notLoggedIn = document.getElementById('curriculum-not-logged-in')
  const coursesContainer = document.getElementById('courses-container')
  const generateButtonContainer =
    document.getElementById('generate-button-container') || createGenerateButtonContainer()

  if (!loadingIndicator || !curriculumContent || !notLoggedIn || !coursesContainer) {
    console.error('Required curriculum DOM elements not found')
    return
  }

  // Show loading, hide other sections
  loadingIndicator.style.display = 'flex'
  curriculumContent.style.display = 'none'
  notLoggedIn.style.display = 'none'
  generateButtonContainer.style.display = 'none'

  try {
    console.log('Fetching courses with token...')
    const courses = await classroomService.fetchCourses()

    // Clear existing courses
    coursesContainer.innerHTML = ''

    if (!courses || courses.length === 0) {
      console.log('No courses found, showing empty state')
      coursesContainer.innerHTML = `
        <div class="empty-state">
          <p>No active courses found in your Google Classroom account.</p>
          <p>Make sure you have active courses in Google Classroom and that you've granted the necessary permissions.</p>
          <button class="primary-button" id="retry-classroom">
            <span class="material-icons">refresh</span>
            Retry
          </button>
        </div>
      `

      document.getElementById('retry-classroom')?.addEventListener('click', () => {
        loadCurriculumData()
      })
    } else {
      console.log(`Displaying ${courses.length} courses`)

      // Add a "Select All" option
      const selectAllContainer = document.createElement('div')
      selectAllContainer.className = 'select-all-container'
      selectAllContainer.innerHTML = `
        <label class="select-all-label">
          <input type="checkbox" id="select-all-courses" class="course-checkbox">
          <span>Select All Courses</span>
        </label>
      `
      coursesContainer.appendChild(selectAllContainer)

      // Display each course with checkbox
      courses.forEach((course) => {
        const courseCard = createCourseCard(course)
        coursesContainer.appendChild(courseCard)
      })

      // Add event listeners for checkboxes
      setupCheckboxListeners()

      // Add event listeners for view details buttons
      document.querySelectorAll('.view-details-btn').forEach((button) => {
        button.addEventListener('click', (e) => {
          e.stopPropagation()
          const courseId = button.dataset.courseId
          viewCourseDetails(courseId)
        })
      })
    }

    // Hide loading, show content
    loadingIndicator.style.display = 'none'
    curriculumContent.style.display = 'block'
  } catch (error) {
    console.error('Error loading curriculum data:', error)

    // Show error state
    loadingIndicator.style.display = 'none'
    curriculumContent.style.display = 'block'
    coursesContainer.innerHTML = `
      <div class="error-state">
        <p>Error loading your Google Classroom courses: ${error.message}</p>
        <button class="primary-button" id="retry-classroom">
          <span class="material-icons">refresh</span>
          Retry
        </button>
        <button class="secondary-button" id="relogin-classroom">
          <span class="material-icons">login</span>
          Sign In Again
        </button>
      </div>
    `

    document.getElementById('retry-classroom')?.addEventListener('click', () => {
      loadCurriculumData()
    })

    document.getElementById('relogin-classroom')?.addEventListener('click', async () => {
      try {
        localStorage.removeItem('googleClassroomToken')
        await authService.login()
      } catch (loginError) {
        console.error('Failed to re-login:', loginError)
        alert(`Failed to sign in: ${loginError.message}`)
      }
    })
  }
}

function createCourseCard(course) {
  const courseCard = document.createElement('div')
  courseCard.className = 'course-card'
  courseCard.dataset.courseId = course.id

  courseCard.innerHTML = `
    <div class="course-header">
      <label class="course-select" title="Select this course">
        <input type="checkbox" class="course-checkbox" data-course-id="${course.id}">
        <span class="checkmark"></span>
      </label>
      <div class="course-name">${course.name}</div>
    </div>
    <div class="course-section">${course.section || ''}</div>
    <div class="course-description">${course.description || 'No description available'}</div>
    <button class="view-details-btn" data-course-id="${course.id}">
      <span class="material-icons">visibility</span>
      View Details
    </button>
  `

  return courseCard
}

function createGenerateButtonContainer() {
  const curriculumSection = document.getElementById('curriculum-section')
  const container = document.createElement('div')
  container.id = 'generate-button-container'
  container.className = 'generate-button-container'
  container.style.display = 'none'

  if (curriculumSection) {
    curriculumSection.appendChild(container)
  }

  return container
}

// Updated setupCheckboxListeners function to fix checkbox interactions
function setupCheckboxListeners() {
  // Select All checkbox
  const selectAllCheckbox = document.getElementById('select-all-courses')
  const courseCheckboxes = document.querySelectorAll('.course-checkbox:not(#select-all-courses)')

  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', function () {
      courseCheckboxes.forEach((checkbox) => {
        checkbox.checked = this.checked
      })
      updateGenerateButton()
    })

    // Make sure the label click is propagated to the checkbox
    const selectAllLabel = selectAllCheckbox.closest('.select-all-label')
    if (selectAllLabel) {
      selectAllLabel.addEventListener('click', (e) => {
        // This prevents the card click handler from toggling it again
        e.stopPropagation()
      })
    }
  }

  // Individual course checkboxes
  courseCheckboxes.forEach((checkbox) => {
    checkbox.addEventListener('change', function () {
      updateGenerateButton()

      // Update "Select All" checkbox state
      if (selectAllCheckbox) {
        const allChecked = Array.from(courseCheckboxes).every((cb) => cb.checked)
        const someChecked = Array.from(courseCheckboxes).some((cb) => cb.checked)

        selectAllCheckbox.checked = allChecked
        selectAllCheckbox.indeterminate = someChecked && !allChecked
      }
    })

    // Make sure the label click is propagated to the checkbox
    const checkboxLabel = checkbox.closest('.course-select')
    if (checkboxLabel) {
      checkboxLabel.addEventListener('click', (e) => {
        // This prevents the card click handler from toggling it again
        e.stopPropagation()
      })
    }
  })

  // Update the card click handler to not trigger when clicking on buttons or labels
  document.querySelectorAll('.course-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      // Only handle card clicks if not clicking on a button, checkbox, or label
      if (
        !e.target.closest('.view-details-btn') &&
        !e.target.closest('.course-select') &&
        !e.target.closest('.course-checkbox')
      ) {
        const checkbox = card.querySelector('.course-checkbox')
        if (checkbox) {
          checkbox.checked = !checkbox.checked

          // Trigger change event
          const event = new Event('change')
          checkbox.dispatchEvent(event)
        }
      }
    })
  })

  // Add specific handler for the checkmark spans
  document.querySelectorAll('.checkmark').forEach((checkmark) => {
    checkmark.addEventListener('click', (e) => {
      // Find the associated checkbox
      const checkbox = e.target.closest('.course-select').querySelector('.course-checkbox')
      if (checkbox) {
        // Toggle checkbox
        checkbox.checked = !checkbox.checked

        // Trigger change event
        const event = new Event('change')
        checkbox.dispatchEvent(event)

        // Prevent card click from handling this
        e.stopPropagation()
      }
    })
  })

  // Ensure the "View Details" buttons don't toggle checkboxes
  document.querySelectorAll('.view-details-btn').forEach((button) => {
    button.addEventListener('click', (e) => {
      e.stopPropagation()
      const courseId = button.dataset.courseId
      viewCourseDetails(courseId)
    })
  })
}

function updateGenerateButton() {
  const generateButtonContainer = document.getElementById('generate-button-container')
  const selectedCourses = getSelectedCourses()

  if (!generateButtonContainer) {
    return
  }

  if (selectedCourses.length > 0) {
    generateButtonContainer.style.display = 'block'
    generateButtonContainer.innerHTML = `
      <div class="selected-count">${selectedCourses.length} course${selectedCourses.length === 1 ? '' : 's'} selected</div>
      <div class="generate-buttons">
        <button id="generate-smart-curriculum-btn" class="primary-button">
          <span class="material-icons">psychology</span>
          Smart Curriculum
        </button>
      </div>
    `

    // Add event listener for generate button
    document.getElementById('generate-curriculum-btn')?.addEventListener('click', () => {
      generateCurriculum(selectedCourses, false) // Regular generation
    })

    // Add event listener for smart generate button
    document.getElementById('generate-smart-curriculum-btn')?.addEventListener('click', () => {
      generateCurriculum(selectedCourses, true) // Smart AI-based generation
    })
  } else {
    generateButtonContainer.style.display = 'none'
  }
}

function getSelectedCourses() {
  const selectedCheckboxes = document.querySelectorAll(
    '.course-checkbox:checked:not(#select-all-courses)'
  )
  return Array.from(selectedCheckboxes).map((checkbox) => checkbox.dataset.courseId)
}

async function generateCurriculum(courseIds, useSmart = false) {
  if (!courseIds || courseIds.length === 0) {
    alert('Please select at least one course to generate a curriculum.')
    return
  }

  const generateButton = document.getElementById(
    useSmart ? 'generate-smart-curriculum-btn' : 'generate-curriculum-btn'
  )
  const generateButtonContainer = document.getElementById('generate-button-container')

  if (generateButton) {
    // Show loading state
    generateButton.disabled = true
    generateButton.innerHTML = `
      <span class="material-icons rotating">sync</span>
      Generating...
    `
  }

  try {
    // Show loading overlay
    const loadingOverlay = document.createElement('div')
    loadingOverlay.className = 'loading-overlay'
    loadingOverlay.innerHTML = `
      <div class="loading-content">
        <span class="material-icons rotating">psychology</span>
        <p>${useSmart ? 'Analyzing course data and generating smart curriculum...' : 'Generating curriculum...'}</p>
      </div>
    `
    document.body.appendChild(loadingOverlay)

    // Collect course details for selected courses
    const selectedCourses = []
    for (const courseId of courseIds) {
      try {
        const courseWork = await classroomService.fetchCourseWork(courseId)
        const courseElement = document.querySelector(`.course-card[data-course-id="${courseId}"]`)
        const courseName =
          courseElement?.querySelector('.course-name')?.textContent || 'Unknown Course'

        selectedCourses.push({
          id: courseId,
          name: courseName,
          courseWork: courseWork
        })
      } catch (error) {
        console.error(`Error fetching course work for course ${courseId}:`, error)
      }
    }

    // Generate curriculum based on method
    if (useSmart) {
      // Get focus sessions for preferences
      const focusSessions = loadFocusSessions()

      // Extract user preferences
      const userPreferences = extractUserPreferencesFromFocusSessions(focusSessions)

      // Generate smart curriculum
      const smartResult = await generateSmartCurriculum(selectedCourses, userPreferences)

      if (smartResult.success) {
        showSmartCurriculum(selectedCourses, smartResult)
      } else {
        alert(smartResult.message || 'Failed to generate smart curriculum')
      }
    } else {
      // Show normal curriculum
      showGeneratedCurriculum(selectedCourses)
    }

    // Remove loading overlay
    document.body.removeChild(loadingOverlay)
  } catch (error) {
    console.error('Error generating curriculum:', error)
    alert(`Failed to generate curriculum: ${error.message}`)

    // Remove any loading overlay
    const existingOverlay = document.querySelector('.loading-overlay')
    if (existingOverlay) {
      document.body.removeChild(existingOverlay)
    }
  } finally {
    if (generateButton) {
      // Reset button state
      generateButton.disabled = false
      generateButton.innerHTML = useSmart
        ? `<span class="material-icons">psychology</span> Smart Curriculum`
        : `<span class="material-icons">auto_awesome</span> Generate Curriculum`
    }
  }
}

// Extract user preferences from focus sessions
function extractUserPreferencesFromFocusSessions(sessions) {
  if (!sessions || sessions.length === 0) {
    return {
      preferredDifficulty: 0.5, // Default medium difficulty
      availableHoursPerWeek: 10, // Default 10 hours/week
      prioritizeDeadlines: true
    }
  }

  // Calculate average session duration
  const avgSessionDuration =
    sessions.reduce((total, session) => {
      const duration = (session.endTime - session.startTime) / (1000 * 60 * 60) // hours
      return total + duration
    }, 0) / sessions.length

  // Calculate average attention score
  const avgAttentionScore =
    sessions.reduce((total, session) => {
      return total + session.attentionScore
    }, 0) / sessions.length

  // Estimate available time per week based on past sessions
  const sessionsPerWeek = Math.min(sessions.length / 4, 5) // Assume data from last 4 weeks, max 5 sessions/week
  const availableHoursPerWeek = Math.max(5, Math.min(20, sessionsPerWeek * avgSessionDuration))

  // Determine preferred difficulty based on attention score
  // Higher attention score = can handle higher difficulty
  const preferredDifficulty =
    avgAttentionScore >= 80
      ? 0.8
      : avgAttentionScore >= 60
        ? 0.6
        : avgAttentionScore >= 40
          ? 0.4
          : 0.3

  return {
    preferredDifficulty,
    availableHoursPerWeek,
    prioritizeDeadlines: true // Default to prioritizing deadlines
  }
}

// Display smart curriculum
function showSmartCurriculum(courses, smartResult) {
  // Hide courses container and show curriculum view
  const coursesContainer = document.getElementById('courses-container')
  const generateButtonContainer = document.getElementById('generate-button-container')

  if (coursesContainer) {
    coursesContainer.style.display = 'none'
  }

  if (generateButtonContainer) {
    generateButtonContainer.style.display = 'none'
  }

  // Create curriculum container if it doesn't exist
  let curriculumContainer = document.getElementById('generated-curriculum-container')
  if (!curriculumContainer) {
    curriculumContainer = document.createElement('div')
    curriculumContainer.id = 'generated-curriculum-container'
    curriculumContainer.className = 'generated-curriculum-container'

    const curriculumContent = document.getElementById('curriculum-content')
    if (curriculumContent) {
      curriculumContent.appendChild(curriculumContainer)
    }
  }

  // Get course and assignment counts
  const courseCount = courses.length
  const totalAssignments = courses.reduce(
    (total, course) => total + (course.courseWork?.length || 0),
    0
  )

  // Generate schedule weeks HTML
  const scheduleWeeksHTML = smartResult.weeklySchedule
    .map((week) => {
      return `
      <div class="schedule-week">
        <h4>Week ${week.week}: ${formatDateShort(week.startDate)} - ${formatDateShort(week.endDate)}</h4>
        <div class="schedule-days">
          ${week.days
            .map((day) => {
              const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day.day]
              return `
              <div class="schedule-day">
                <div class="day-header">${dayName} ${formatDateShort(day.date)}</div>
                <div class="day-assignments">
                  ${
                    day.assignments.length === 0
                      ? `<div class="empty-day">No assignments scheduled</div>`
                      : day.assignments
                          .map(
                            (assignment) => `
                      <div class="schedule-assignment">
                        <div class="assignment-icon">
                          <span class="material-icons">${getWorkTypeIcon(assignment.type)}</span>
                        </div>
                        <div class="assignment-details">
                          <div class="assignment-title">${assignment.title}</div>
                          <div class="assignment-course">${assignment.courseName}</div>
                          <div class="assignment-time">
                            <span class="material-icons">schedule</span> ${assignment.estimatedHours.toFixed(1)} hrs
                            ${
                              assignment.dueDate
                                ? `<span class="due-date">Due: ${formatDateShort(assignment.dueDate)}</span>`
                                : ''
                            }
                          </div>
                        </div>
                      </div>
                    `
                          )
                          .join('')
                  }
                </div>
              </div>
            `
            })
            .join('')}
        </div>
      </div>
    `
    })
    .join('')

  // Generate course breakdown HTML
  const courseBreakdownHTML = smartResult.courseBreakdown
    .map((course) => {
      return `
      <div class="course-breakdown-item">
        <div class="course-name">${course.courseName}</div>
        <div class="course-stats">
          <div class="stat-item">
            <span class="material-icons">assignment</span>
            ${course.assignmentCount} assignments
          </div>
          <div class="stat-item">
            <span class="material-icons">schedule</span>
            ${course.totalHours.toFixed(1)} hours
          </div>
        </div>
      </div>
    `
    })
    .join('')

  curriculumContainer.innerHTML = `
    <div class="curriculum-header">
      <h3>Your AI-Optimized Curriculum</h3>
      <button id="back-to-courses" class="secondary-button">
        <span class="material-icons">arrow_back</span>
        Back to Courses
      </button>
    </div>
    
    <div class="curriculum-summary">
      <div class="summary-card">
        <div class="summary-icon"><span class="material-icons">school</span></div>
        <div class="summary-count">${courseCount}</div>
        <div class="summary-label">Courses</div>
      </div>
      <div class="summary-card">
        <div class="summary-icon"><span class="material-icons">assignment</span></div>
        <div class="summary-count">${totalAssignments}</div>
        <div class="summary-label">Assignments</div>
      </div>
      <div class="summary-card">
        <div class="summary-icon"><span class="material-icons">schedule</span></div>
        <div class="summary-count">${Math.round(smartResult.totalEstimatedHours)}</div>
        <div class="summary-label">Est. Hours</div>
      </div>
    </div>
    
    <div class="smart-curriculum-explanation">
      <p>
        <span class="material-icons">psychology</span>
        This AI-optimized curriculum is personalized based on your past focus performance, 
        assignment difficulty, and upcoming deadlines.
      </p>
    </div>
    
    <div class="schedule-container">
      <h4>Personalized Study Schedule</h4>
      ${scheduleWeeksHTML}
    </div>
    
    <div class="course-breakdown">
      <h4>Course Breakdown</h4>
      <div class="course-breakdown-list">
        ${courseBreakdownHTML}
      </div>
    </div>
  `

  // Display the curriculum container
  curriculumContainer.style.display = 'block'

  // Add event listener for back button
  document.getElementById('back-to-courses')?.addEventListener('click', () => {
    curriculumContainer.style.display = 'none'

    if (coursesContainer) {
      coursesContainer.style.display = 'grid'
    }

    updateGenerateButton()
  })
}

function showGeneratedCurriculum(courses) {
  // Hide courses container and show curriculum view
  const coursesContainer = document.getElementById('courses-container')
  const generateButtonContainer = document.getElementById('generate-button-container')

  if (coursesContainer) {
    coursesContainer.style.display = 'none'
  }

  if (generateButtonContainer) {
    generateButtonContainer.style.display = 'none'
  }

  // Create curriculum container if it doesn't exist
  let curriculumContainer = document.getElementById('generated-curriculum-container')
  if (!curriculumContainer) {
    curriculumContainer = document.createElement('div')
    curriculumContainer.id = 'generated-curriculum-container'
    curriculumContainer.className = 'generated-curriculum-container'

    const curriculumContent = document.getElementById('curriculum-content')
    if (curriculumContent) {
      curriculumContent.appendChild(curriculumContainer)
    }
  }

  // Generate curriculum content
  const courseCount = courses.length
  const totalAssignments = courses.reduce(
    (total, course) => total + (course.courseWork?.length || 0),
    0
  )

  curriculumContainer.innerHTML = `
    <div class="curriculum-header">
      <h3>Your Personalized Curriculum</h3>
      <button id="back-to-courses" class="secondary-button">
        <span class="material-icons">arrow_back</span>
        Back to Courses
      </button>
    </div>
    
    <div class="curriculum-summary">
      <div class="summary-card">
        <div class="summary-icon"><span class="material-icons">school</span></div>
        <div class="summary-count">${courseCount}</div>
        <div class="summary-label">Courses</div>
      </div>
      <div class="summary-card">
        <div class="summary-icon"><span class="material-icons">assignment</span></div>
        <div class="summary-count">${totalAssignments}</div>
        <div class="summary-label">Assignments</div>
        </div>
     <div class="summary-card">
       <div class="summary-icon"><span class="material-icons">schedule</span></div>
       <div class="summary-count">${Math.ceil(totalAssignments * 1.5)}</div>
       <div class="summary-label">Est. Hours</div>
     </div>
   </div>
   
   <div class="curriculum-timeline">
     <h4>Study Timeline</h4>
     <div class="timeline-container">
       ${generateTimelineHTML(courses)}
     </div>
   </div>
   
   <div class="curriculum-courses">
     <h4>Course Materials</h4>
     ${courses
       .map(
         (course) => `
       <div class="curriculum-course-card">
         <h5>${course.name}</h5>
         <div class="course-materials">
           ${
             course.courseWork && course.courseWork.length > 0
               ? `<ul class="materials-list">
                 ${course.courseWork
                   .map(
                     (work) => `
                   <li class="material-item">
                     <span class="material-icons">${getWorkTypeIcon(work.workType)}</span>
                     <div class="material-details">
                       <div class="material-title">${work.title}</div>
                       ${work.dueDate ? `<div class="material-due">Due: ${formatDate(work.dueDate)}</div>` : ''}
                     </div>
                   </li>
                 `
                   )
                   .join('')}
               </ul>`
               : '<p class="empty-message">No course materials available</p>'
           }
         </div>
       </div>
     `
       )
       .join('')}
   </div>
 `

  // Display the curriculum container
  curriculumContainer.style.display = 'block'

  // Add event listener for back button
  document.getElementById('back-to-courses')?.addEventListener('click', () => {
    curriculumContainer.style.display = 'none'

    if (coursesContainer) {
      coursesContainer.style.display = 'grid'
    }

    updateGenerateButton()
  })
}

function generateTimelineHTML(courses) {
  // Get all assignments with due dates
  const assignmentsWithDates = []

  courses.forEach((course) => {
    if (course.courseWork && course.courseWork.length > 0) {
      course.courseWork.forEach((work) => {
        if (work.dueDate) {
          assignmentsWithDates.push({
            title: work.title,
            courseName: course.name,
            dueDate: createDateFromDueDate(work.dueDate),
            workType: work.workType || 'ASSIGNMENT'
          })
        }
      })
    }
  })

  // Sort assignments by due date
  assignmentsWithDates.sort((a, b) => a.dueDate - b.dueDate)

  // Group assignments by week
  const today = new Date()
  const weekMilliseconds = 7 * 24 * 60 * 60 * 1000
  const weeks = []

  // Create 4 weeks starting from today
  for (let i = 0; i < 4; i++) {
    const startDate = new Date(today.getTime() + i * weekMilliseconds)
    const endDate = new Date(startDate.getTime() + weekMilliseconds - 1)

    weeks.push({
      startDate,
      endDate,
      assignments: []
    })
  }

  // Assign each assignment to a week
  assignmentsWithDates.forEach((assignment) => {
    for (const week of weeks) {
      if (assignment.dueDate >= week.startDate && assignment.dueDate <= week.endDate) {
        week.assignments.push(assignment)
        break
      }
    }
  })

  // Generate HTML for timeline
  return `
   <div class="timeline">
     ${weeks
       .map(
         (week, index) => `
       <div class="timeline-week">
         <div class="timeline-week-header">
           <div class="week-number">Week ${index + 1}</div>
           <div class="week-dates">${formatDateShort(week.startDate)} - ${formatDateShort(week.endDate)}</div>
         </div>
         <div class="timeline-assignments">
           ${
             week.assignments.length > 0
               ? week.assignments
                   .map(
                     (assignment) => `
               <div class="timeline-assignment">
                 <div class="assignment-icon">
                   <span class="material-icons">${getWorkTypeIcon(assignment.workType)}</span>
                 </div>
                 <div class="assignment-details">
                   <div class="assignment-title">${assignment.title}</div>
                   <div class="assignment-course">${assignment.courseName}</div>
                   <div class="assignment-due">Due: ${formatDateShort(assignment.dueDate)}</div>
                 </div>
               </div>
             `
                   )
                   .join('')
               : '<div class="empty-week">No assignments due this week</div>'
           }
         </div>
       </div>
     `
       )
       .join('')}
   </div>
 `
}

function createDateFromDueDate(dueDate) {
  return new Date(dueDate.year, (dueDate.month || 1) - 1, dueDate.day || 1)
}

function formatDateShort(date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric'
  }).format(date)
}

function getWorkTypeIcon(workType) {
  switch (workType) {
    case 'ASSIGNMENT':
      return 'assignment'
    case 'SHORT_ANSWER_QUESTION':
      return 'question_answer'
    case 'MULTIPLE_CHOICE_QUESTION':
      return 'quiz'
    case 'QUIZ':
      return 'quiz'
    case 'TEST':
      return 'fact_check'
    case 'MATERIAL':
      return 'book'
    default:
      return 'assignment'
  }
}

// Helper function to format date
function formatDate(dateObj) {
  if (!dateObj) return 'No due date'

  try {
    const date = createDateFromDueDate(dateObj)
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    })
  } catch (e) {
    return 'Invalid date'
  }
}

// Updated viewCourseDetails function that properly displays a modal
async function viewCourseDetails(courseId) {
  try {
    // Show loading indicator
    const loadingIndicator = document.createElement('div')
    loadingIndicator.className = 'loading-indicator'
    loadingIndicator.innerHTML = `
     <span class="material-icons rotating">sync</span>
     <p>Loading course details...</p>
   `
    document.body.appendChild(loadingIndicator)

    // Fetch course work data
    const courseWork = await classroomService.fetchCourseWork(courseId)

    // Remove loading indicator
    document.body.removeChild(loadingIndicator)

    // Get course name
    const courseElement = document.querySelector(`.course-card[data-course-id="${courseId}"]`)
    const courseName = courseElement?.querySelector('.course-name')?.textContent || 'Course Details'

    // Create the modal
    const modal = document.createElement('div')
    modal.className = 'modal'
    modal.id = `course-details-modal-${courseId}`
    modal.innerHTML = `
     <div class="modal-content">
       <div class="modal-header">
         <h2>${courseName}</h2>
         <button class="close-button">&times;</button>
       </div>
       <div class="modal-body">
         <h3>Assignments and Materials</h3>
         <div class="coursework-list">
           ${
             courseWork.length === 0
               ? '<p class="empty-state">No assignments or materials found for this course.</p>'
               : courseWork
                   .map(
                     (item) => `
               <div class="coursework-item">
                 <div class="coursework-title">
                   <span class="material-icons">${getWorkTypeIcon(item.workType)}</span>
                   ${item.title}
                 </div>
                 ${
                   item.description
                     ? `<div class="coursework-description">${item.description}</div>`
                     : ''
                 }
                 <div class="coursework-meta">
                   <span class="coursework-type">${item.workType || 'Assignment'}</span>
                   ${
                     item.dueDate
                       ? `<span class="coursework-due">Due: ${formatDate(item.dueDate)}</span>`
                       : ''
                   }
                 </div>
               </div>
             `
                   )
                   .join('')
           }
         </div>
       </div>
     </div>
   `

    // Add the modal to the body
    document.body.appendChild(modal)

    // Force a reflow before adding the active class (for animation)
    void modal.offsetWidth

    // Show the modal with animation
    setTimeout(() => {
      modal.classList.add('active')
    }, 10)

    // Add event listener to close button
    modal.querySelector('.close-button').addEventListener('click', () => {
      closeModal(modal)
    })

    // Close modal when clicking outside of content
    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        closeModal(modal)
      }
    })

    // Add keyboard events for accessibility
    document.addEventListener('keydown', function escKeyHandler(e) {
      if (e.key === 'Escape') {
        closeModal(modal)
        document.removeEventListener('keydown', escKeyHandler)
      }
    })
  } catch (error) {
    console.error('Error loading course details:', error)

    // Show error in a clean modal
    const errorModal = document.createElement('div')
    errorModal.className = 'modal active'
    errorModal.innerHTML = `
     <div class="modal-content">
       <div class="modal-header">
         <h2>Error</h2>
         <button class="close-button">&times;</button>
       </div>
       <div class="modal-body">
         <p>Failed to load course details: ${error.message}</p>
         <button class="primary-button" id="retry-course-details">
           <span class="material-icons">refresh</span>
           Retry
         </button>
       </div>
     </div>
   `

    document.body.appendChild(errorModal)

    // Set up event listeners for error modal
    errorModal.querySelector('.close-button').addEventListener('click', () => {
      closeModal(errorModal)
    })

    errorModal.querySelector('#retry-course-details')?.addEventListener('click', () => {
      closeModal(errorModal)
      viewCourseDetails(courseId)
    })

    errorModal.addEventListener('click', (event) => {
      if (event.target === errorModal) {
        closeModal(errorModal)
      }
    })
  }
}

// Helper function to close modal with animation
function closeModal(modalElement) {
  modalElement.classList.remove('active')

  // Wait for animation to complete before removing from DOM
  setTimeout(() => {
    if (document.body.contains(modalElement)) {
      document.body.removeChild(modalElement)
    }
  }, 300) // Match this to your CSS transition duration
}

// Initialize Navigation
function initNavigation() {
  console.log('Initializing navigation...')

  document.querySelectorAll('.nav-btn').forEach((button) => {
    button.addEventListener('click', () => {
      // Remove active class from all buttons and sections
      document.querySelectorAll('.nav-btn').forEach((btn) => btn.classList.remove('active'))
      document
        .querySelectorAll('.content-section')
        .forEach((section) => section.classList.remove('active'))

      // Add active class to clicked button and corresponding section
      button.classList.add('active')
      const sectionId = button.dataset.section + '-section'
      const section = document.getElementById(sectionId)

      if (section) {
        section.classList.add('active')

        // If switching to curriculum section, load data
        if (sectionId === 'curriculum-section' && authService.isLoggedIn()) {
          loadCurriculumData()
        }

        // If switching to focus section, initialize focus tracking
        if (sectionId === 'focus-section') {
          initializeFocusTracking()
        }
      } else {
        console.error(`Section with ID "${sectionId}" not found`)
      }
    })
  })
}

// Initialize Settings
function initSettings() {
  console.log('Initializing settings...')

  // Theme options
  document.querySelectorAll('.theme-option').forEach((option) => {
    option.addEventListener('click', () => {
      const theme = option.dataset.theme
      document.querySelectorAll('.theme-option').forEach((btn) => btn.classList.remove('active'))
      option.classList.add('active')
      themeManager.setTheme(theme)
    })
  })

  // Theme toggle button
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    themeManager.toggleTheme()
  })

  // Connect Classroom button - use auth service login
  document.getElementById('connect-classroom')?.addEventListener('click', async () => {
    console.log('Connecting to Google Classroom...')
    try {
      await authService.login()
    } catch (error) {
      console.error('Failed to connect to Google Classroom:', error)
      alert(`Failed to connect to Google Classroom: ${error.message}`)
    }
  })
}

// Window control buttons
function initWindowControls() {
  console.log('Initializing window controls...')

  // Set up window control buttons
  if (ipcRenderer) {
    document.getElementById('minimize')?.addEventListener('click', () => {
      console.log('Minimize button clicked')
      ipcRenderer.send('window-control', 'minimize')
    })

    document.getElementById('maximize')?.addEventListener('click', () => {
      console.log('Maximize button clicked')
      ipcRenderer.send('window-control', 'maximize')
    })

    document.getElementById('close')?.addEventListener('click', () => {
      console.log('Close button clicked')
      ipcRenderer.send('window-control', 'close')
    })
  } else {
    console.warn('IPC Renderer not available - window controls will not function')
  }
}

// Call initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded, initializing application...')

  // Debug logging for button detection
  console.log('Login button:', document.getElementById('login-button'))
  console.log('Curriculum login button:', document.getElementById('curriculum-login-button'))

  console.log('All buttons on the page:')
  document.querySelectorAll('button').forEach((button, index) => {
    console.log(`Button ${index}:`, button, 'ID:', button.id)
  })

  // Initialize the application
  initApp()
})

// Export services for use in other modules
export { authService, classroomService, handleRedirectResult }
