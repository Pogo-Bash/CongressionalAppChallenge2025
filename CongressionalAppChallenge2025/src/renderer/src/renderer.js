// Import theme manager
import { themeManager } from './theme-manager.js'
import * as tf from '@tensorflow/tfjs'
import {
  updateFocusChart,
  createD3FocusChart,
  createPlaceholderChart,
  debounce
} from './focus-chart.js'
import * as d3 from 'd3'

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
googleProvider.addScope('https://www.googleapis.com/auth/classroom.coursework.students')
googleProvider.addScope('https://www.googleapis.com/auth/classroom.coursework.me')
googleProvider.addScope('https://www.googleapis.com/auth/classroom.rosters.readonly')
googleProvider.addScope('https://www.googleapis.com/auth/classroom.profile.emails')
googleProvider.addScope('https://www.googleapis.com/auth/classroom.student-submissions.me.readonly')
googleProvider.addScope(
  'https://www.googleapis.com/auth/classroom.student-submissions.students.readonly'
)

// Focus Sessions Management
let focusSessionsCache = []

// TensorFlow Model

// Declare variables at the module level
let tensorflowModel = null
let faceDetector = null
let focusTrackingInitialized = false

// Replace the initializeTensorFlow function in your renderer.js with this updated version
// Replace the initializeTensorFlow function in your renderer.js with this fixed version
async function initializeTensorFlow() {
  if (focusTrackingInitialized) return true

  try {
    console.log('Initializing TensorFlow.js...')

    // Explicitly import both necessary packages
    const tf = await import('@tensorflow/tfjs')
    console.log('TensorFlow core loaded successfully')

    // Import face detection
    const faceDetection = await import('@tensorflow-models/face-detection')
    console.log('Face detection module loaded successfully')

    // Check for valid imports
    if (!faceDetection || !faceDetection.SupportedModels) {
      console.error('Face detection module missing SupportedModels:', faceDetection)
      throw new Error('Face detection module loaded incorrectly')
    }

    // Choose appropriate backend
    if (tf.engine().backendNames().includes('webgl')) {
      await tf.setBackend('webgl')
      console.log('Using WebGL backend')
    } else {
      await tf.setBackend('cpu')
      console.log('Using CPU backend (WebGL not available)')
    }

    // Log available models
    console.log('Available face detection models:', Object.keys(faceDetection.SupportedModels))

    // Create model config - FIXED: Adding the required runtime property
    const modelConfig = {
      runtime: 'tfjs', // Required parameter
      modelType: 'short',
      maxFaces: 1
    }

    // Use MediaPipeFaceDetector instead of BlazeFace
    const modelName = faceDetection.SupportedModels.MediaPipeFaceDetector

    // Make sure model name is valid
    if (!modelName) {
      throw new Error('MediaPipeFaceDetector model not available in SupportedModels')
    }

    console.log('Creating detector with model:', modelName, 'and config:', modelConfig)

    // Create the detector
    faceDetector = await faceDetection.createDetector(modelName, modelConfig)

    if (!faceDetector) {
      throw new Error('Failed to create face detector')
    }

    console.log('Face detector created successfully')

    // Store the model
    tensorflowModel = faceDetector
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
// In renderer.js, improve the extractAndStoreToken function:
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

    const token = credential.accessToken

    if (!token) {
      console.error('No access token in credential')
      return false
    }

    console.log('Token obtained, length:', token.length)

    // Store the token
    localStorage.setItem('googleClassroomToken', token)

    // Log token for debugging (first few chars only)
    console.log('Token prefix:', token.substring(0, 10) + '...')

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

    // Add comprehensive scopes for coursework access
    provider.addScope('https://www.googleapis.com/auth/classroom.courses.readonly')
    provider.addScope('https://www.googleapis.com/auth/classroom.coursework.me.readonly')
    provider.addScope('https://www.googleapis.com/auth/classroom.coursework.students')
    provider.addScope('https://www.googleapis.com/auth/classroom.coursework.me')
    provider.addScope('https://www.googleapis.com/auth/classroom.rosters.readonly')
    provider.addScope('https://www.googleapis.com/auth/classroom.profile.emails')
    provider.addScope('https://www.googleapis.com/auth/classroom.student-submissions.me.readonly')
    provider.addScope(
      'https://www.googleapis.com/auth/classroom.student-submissions.students.readonly'
    )

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

        // Save token scopes for debugging if available
        if (credential.scope) {
          localStorage.setItem('googleClassroomTokenScopes', credential.scope)
          console.log('Token scopes saved:', credential.scope)
        }
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

    // Add comprehensive scopes for coursework access
    provider.addScope('https://www.googleapis.com/auth/classroom.courses.readonly')
    provider.addScope('https://www.googleapis.com/auth/classroom.coursework.me.readonly')
    provider.addScope('https://www.googleapis.com/auth/classroom.coursework.students')
    provider.addScope('https://www.googleapis.com/auth/classroom.coursework.me')
    provider.addScope('https://www.googleapis.com/auth/classroom.rosters.readonly')
    provider.addScope('https://www.googleapis.com/auth/classroom.profile.emails')
    provider.addScope('https://www.googleapis.com/auth/classroom.student-submissions.me.readonly')
    provider.addScope(
      'https://www.googleapis.com/auth/classroom.student-submissions.students.readonly'
    )

    // Set parameters for same account - changed to 'consent' to ensure we get all permissions
    provider.setCustomParameters({
      prompt: 'consent', // Always ask for consent to ensure we get fresh permissions
      access_type: 'offline' // Get refresh token
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
    localStorage.removeItem('googleClassroomTokenScopes') // Also clear scopes for clean state
    try {
      await signOut(auth)
    } catch (signOutError) {
      console.warn('Error signing out before new account auth:', signOutError)
    }

    const provider = new GoogleAuthProvider()

    // Add comprehensive scopes for coursework access
    provider.addScope('https://www.googleapis.com/auth/classroom.courses.readonly')
    provider.addScope('https://www.googleapis.com/auth/classroom.coursework.me.readonly')
    provider.addScope('https://www.googleapis.com/auth/classroom.coursework.students')
    provider.addScope('https://www.googleapis.com/auth/classroom.coursework.me')
    provider.addScope('https://www.googleapis.com/auth/classroom.rosters.readonly')
    provider.addScope('https://www.googleapis.com/auth/classroom.profile.emails')
    provider.addScope('https://www.googleapis.com/auth/classroom.student-submissions.me.readonly')
    provider.addScope(
      'https://www.googleapis.com/auth/classroom.student-submissions.students.readonly'
    )

    if (window.env?.firebaseConfig?.clientId) {
      provider.setCustomParameters({
        client_id: window.env.firebaseConfig.clientId,
        prompt: 'select_account', // Force account selection
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

// Updated function to extract and store token with scope information
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

  // Update the fetchCourses method in classroomService
  async fetchCourses() {
    const token = this.getToken()
    if (!token) {
      throw new Error('Not authenticated with Google Classroom')
    }

    try {
      console.log('Fetching Google Classroom courses...')

      let response
      // Use Electron proxy if available
      if (window.electron?.ipcRenderer?.proxyRequest) {
        console.log('Using Electron proxy for Google Classroom API request')
        response = await window.electron.ipcRenderer.proxyRequest(
          `${this.baseUrl}/courses?courseStates=ACTIVE`,
          {
            headers: {
              Authorization: `Bearer ${token}`
            }
          }
        )

        // Handle proxy response format
        if (!response.ok) {
          console.error('Proxy API error:', response.status, response.data)

          if (response.status === 401) {
            localStorage.removeItem('googleClassroomToken')
            throw new Error('Authentication token expired. Please sign in again.')
          }

          throw new Error(`Failed to fetch courses: ${response.status}`)
        }

        // Extract data from proxy response
        return response.isJson ? response.data.courses || [] : []
      } else {
        // Regular fetch as fallback
        response = await fetch(`${this.baseUrl}/courses?courseStates=ACTIVE`, {
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
        this.courseData = data.courses || []
        return this.courseData
      }
    } catch (error) {
      console.error('Error fetching Google Classroom courses:', error)
      throw error
    }
  },

  // Enhanced fetchCourseWork that tries multiple approaches
  async fetchCourseWork(courseId) {
    const token = this.getToken()
    if (!token) {
      throw new Error('Not authenticated with Google Classroom')
    }

    // Helper function for fetch with CORS handling
    // Helper function for fetch with CORS handling
    // Helper function for fetch with CORS handling
    const fetchWithCORS = async (url, options = {}) => {
      // Check if we're in Electron and have access to the proxy
      if (
        window.electron &&
        window.electron.ipcRenderer &&
        window.electron.ipcRenderer.proxyRequest
      ) {
        try {
          console.log(`Using Electron proxy for: ${url}`)
          // Use our specialized proxy method
          const proxyResponse = await window.electron.ipcRenderer.proxyRequest(url, options)

          // Convert the proxy response to a fetch-like response if needed
          if (proxyResponse.isJson !== undefined) {
            // This is our custom proxy response
            // Create methods to match fetch Response API
            proxyResponse.json = async () =>
              proxyResponse.isJson ? proxyResponse.data : JSON.parse(proxyResponse.data)
            proxyResponse.text = async () =>
              proxyResponse.isJson ? JSON.stringify(proxyResponse.data) : proxyResponse.data
          }

          return proxyResponse
        } catch (error) {
          console.error('Error using Electron proxy:', error)
          // Let it fall through to regular fetch
        }
      }

      // Fall back to regular fetch
      return fetch(url, options)
    }

    console.log(`Attempting to fetch coursework for course ${courseId}...`)

    // Track if we've found any content
    let foundContent = false

    // Try student-specific regular coursework first
    try {
      console.log(`Fetching student coursework for course ${courseId}...`)
      const response = await fetchWithCORS(`${this.baseUrl}/courses/${courseId}/courseWork`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      console.log(`Student coursework response status: ${response.status}`)

      if (response.ok) {
        const data = await response.json()
        console.log('Student coursework data:', data)

        if (data.courseWork && data.courseWork.length > 0) {
          console.log(`Found ${data.courseWork.length} coursework items as student`)
          foundContent = true
          return data.courseWork
        } else {
          console.log('No coursework found in student endpoint response')
        }
      }
    } catch (error) {
      console.error('Error fetching student coursework:', error)
    }

    // Try to get course materials
    try {
      console.log(`Fetching course materials for course ${courseId}...`)
      const response = await fetchWithCORS(
        `${this.baseUrl}/courses/${courseId}/courseWorkMaterials`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      )

      console.log(`Course materials response status: ${response.status}`)

      if (response.ok) {
        const data = await response.json()
        console.log('Course materials data:', data)

        if (data.courseWorkMaterial && data.courseWorkMaterial.length > 0) {
          console.log(`Found ${data.courseWorkMaterial.length} course materials`)

          // Convert materials format to match coursework format
          const formattedMaterials = data.courseWorkMaterial.map((material) => ({
            id: material.id,
            title: material.title,
            description: material.description,
            materials: material.materials,
            state: material.state,
            alternateLink: material.alternateLink,
            creationTime: material.creationTime,
            updateTime: material.updateTime,
            workType: 'MATERIAL' // Custom type for materials
          }))

          foundContent = true
          return formattedMaterials
        } else {
          console.log('No course materials found')
        }
      }
    } catch (error) {
      console.error('Error fetching course materials:', error)
    }

    // Try to get announcements
    try {
      console.log(`Fetching announcements for course ${courseId}...`)
      const response = await fetchWithCORS(`${this.baseUrl}/courses/${courseId}/announcements`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      console.log(`Announcements response status: ${response.status}`)

      if (response.ok) {
        const data = await response.json()
        console.log('Announcements data:', data)

        if (data.announcements && data.announcements.length > 0) {
          console.log(`Found ${data.announcements.length} announcements`)
          // Convert announcements to a format similar to coursework
          const formattedAnnouncements = data.announcements.map((announcement) => ({
            id: announcement.id,
            title: announcement.text
              ? announcement.text.substring(0, 50) + (announcement.text.length > 50 ? '...' : '')
              : 'Announcement',
            description: announcement.text,
            creationTime: announcement.creationTime,
            updateTime: announcement.updateTime,
            alternateLink: announcement.alternateLink,
            workType: 'ANNOUNCEMENT'
          }))

          foundContent = true
          return formattedAnnouncements
        } else {
          console.log('No announcements found')
        }
      }
    } catch (error) {
      console.error('Error fetching announcements:', error)
    }

    // Try accessing submissions as a student
    try {
      console.log(`Fetching student submissions for course ${courseId}...`)

      // First try with /me endpoint
      let response
      try {
        response = await fetchWithCORS(
          `${this.baseUrl}/courses/${courseId}/courseWork/-/studentSubmissions?studentId=me`,
          {
            headers: {
              Authorization: `Bearer ${token}`
            }
          }
        )
      } catch (error) {
        console.log('Error with /me endpoint, trying alternative:', error)

        // If that fails, try all student submissions endpoint
        response = await fetchWithCORS(
          `${this.baseUrl}/courses/${courseId}/courseWork/-/studentSubmissions`,
          {
            headers: {
              Authorization: `Bearer ${token}`
            }
          }
        )
      }

      console.log(`Student submissions response status: ${response.status}`)

      if (response.ok) {
        const data = await response.json()
        console.log('Student submissions data:', data)

        if (data.studentSubmissions && data.studentSubmissions.length > 0) {
          console.log(`Found ${data.studentSubmissions.length} student submissions`)

          // Extract unique courseWorkIds from submissions
          const courseWorkIds = [
            ...new Set(
              data.studentSubmissions
                .filter((sub) => sub.courseWorkId)
                .map((sub) => sub.courseWorkId)
            )
          ]

          console.log(`Found ${courseWorkIds.length} unique courseWork IDs from submissions`)

          // If we found IDs, fetch the actual coursework for each
          if (courseWorkIds.length > 0) {
            const courseworks = []

            for (const workId of courseWorkIds) {
              try {
                const workResponse = await fetchWithCORS(
                  `${this.baseUrl}/courses/${courseId}/courseWork/${workId}`,
                  { headers: { Authorization: `Bearer ${token}` } }
                )

                if (workResponse.ok) {
                  const workData = await workResponse.json()
                  courseworks.push(workData)
                }
              } catch (err) {
                console.error(`Error fetching coursework ${workId}:`, err)
              }
            }

            if (courseworks.length > 0) {
              console.log(
                `Successfully retrieved ${courseworks.length} coursework items from submissions`
              )
              foundContent = true
              return courseworks
            }
          }

          // If we couldn't get the coursework details, create placeholders from submissions
          console.log('Creating placeholder coursework items from submissions')
          const placeholderWorks = []
          const groupedSubmissions = {}

          // Group submissions by courseWorkId
          data.studentSubmissions.forEach((sub) => {
            if (sub.courseWorkId) {
              if (!groupedSubmissions[sub.courseWorkId]) {
                groupedSubmissions[sub.courseWorkId] = []
              }
              groupedSubmissions[sub.courseWorkId].push(sub)
            }
          })

          // Create a placeholder for each course work
          Object.entries(groupedSubmissions).forEach(([workId, submissions]) => {
            // Use the first submission to get info
            const firstSub = submissions[0]
            placeholderWorks.push({
              id: workId,
              title: firstSub.courseWorkTitle || `Assignment ${workId.substring(0, 8)}`,
              description: 'Assignment details not available',
              state: firstSub.state,
              alternateLink: firstSub.alternateLink,
              creationTime: firstSub.creationTime,
              updateTime: firstSub.updateTime,
              workType: 'ASSIGNMENT',
              submissions: submissions.length
            })
          })

          if (placeholderWorks.length > 0) {
            console.log(
              `Created ${placeholderWorks.length} placeholder assignments from submissions`
            )
            foundContent = true
            return placeholderWorks
          }
        } else {
          console.log('No student submissions found')
        }
      }
    } catch (error) {
      console.error('Error fetching student submissions:', error)
    }

    // As a last attempt, try the teacher endpoints if we haven't found anything yet
    if (!foundContent) {
      try {
        console.log(`Trying teacher endpoint for course ${courseId} as fallback...`)
        const response = await fetchWithCORS(`${this.baseUrl}/courses/${courseId}/courseWork`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        })

        console.log(`Teacher endpoint response status: ${response.status}`)

        if (response.ok) {
          const data = await response.json()
          console.log('Teacher endpoint data:', data)

          if (data.courseWork && data.courseWork.length > 0) {
            console.log(`Found ${data.courseWork.length} items from teacher endpoint`)
            return data.courseWork
          }
        }
      } catch (error) {
        console.error('Error with teacher endpoint fallback:', error)
      }
    }

    // If we get here, we couldn't find any course data
    console.log(`No coursework/materials found for course ${courseId}`)

    // Return empty array rather than throwing an error
    return []
  },

  updateCourseWork(courseId, courseWork) {
    if (this.courseData) {
      const course = this.courseData.find((c) => c.id === courseId)
      if (course) {
        course.courseWork = courseWork
        return true
      }
    }
    return false
  },

  getCourseData() {
    return this.courseData
  },

  // Helper method to ensure we have courseWork for all selected courses
  async fetchCourseWorkForCourses(courseIds) {
    if (!courseIds || courseIds.length === 0) {
      return []
    }

    const selectedCourses = []
    for (const courseId of courseIds) {
      try {
        // Check if we already have the course in our data
        const existingCourse = this.courseData?.find((c) => c.id === courseId)
        let courseName = 'Unknown Course'
        let courseWork = []

        if (existingCourse) {
          courseName = existingCourse.name

          // Check if we already have coursework for this course
          if (existingCourse.courseWork) {
            courseWork = existingCourse.courseWork
            console.log(`Using cached coursework for course ${courseId}`)
          } else {
            // Fetch coursework if not cached
            console.log(`Fetching coursework for course ${courseId}`)
            courseWork = await this.fetchCourseWork(courseId)

            // Update cache
            existingCourse.courseWork = courseWork
          }
        } else {
          // Get course name from DOM if needed
          const courseElement = document.querySelector(`.course-card[data-course-id="${courseId}"]`)
          if (courseElement) {
            const courseNameElement = courseElement.querySelector('.course-name')
            if (courseNameElement) {
              courseName = courseNameElement.textContent
            }
          }

          // Fetch coursework
          courseWork = await this.fetchCourseWork(courseId)
        }

        selectedCourses.push({
          id: courseId,
          name: courseName,
          courseWork: courseWork,
          isEmpty: courseWork.length === 0
        })
      } catch (error) {
        console.error(`Error fetching coursework for course ${courseId}:`, error)

        // Still add the course with empty coursework and error info
        const courseElement = document.querySelector(`.course-card[data-course-id="${courseId}"]`)
        let courseName = 'Unknown Course'

        if (courseElement) {
          const courseNameElement = courseElement.querySelector('.course-name')
          if (courseNameElement) {
            courseName = courseNameElement.textContent
          }
        }

        selectedCourses.push({
          id: courseId,
          name: courseName,
          courseWork: [],
          isEmpty: true,
          error: error.message
        })
      }
    }

    return selectedCourses
  },

  // Debug helper to log token and scope information
  debugTokenInfo() {
    const token = this.getToken()
    const scopes = localStorage.getItem('googleClassroomTokenScopes')

    console.log('Token exists:', !!token)
    console.log('Token scopes:', scopes || 'No scope information available')

    if (token) {
      // Log the first 10 characters of the token for debugging
      console.log('Token prefix:', token.substring(0, 10) + '...')
    }

    return {
      hasToken: !!token,
      scopes: scopes ? scopes.split(' ') : []
    }
  },

  // Method to help when testing and debugging
  async testAllEndpoints(courseId) {
    const token = this.getToken()
    if (!token) {
      console.error('No token available for testing')
      return { success: false, error: 'No token available' }
    }

    const results = {
      token: !!token,
      endpoints: {}
    }

    // Test different endpoints
    const endpoints = [
      { name: 'courses', url: `${this.baseUrl}/courses?courseStates=ACTIVE` },
      { name: 'teacherCourseWork', url: `${this.baseUrl}/courses/${courseId}/courseWork` },
      {
        name: 'courseWorkMaterials',
        url: `${this.baseUrl}/courses/${courseId}/courseWorkMaterials`
      },
      {
        name: 'studentSubmissions',
        url: `${this.baseUrl}/courses/${courseId}/courseWork/-/studentSubmissions`
      }
    ]

    for (const endpoint of endpoints) {
      try {
        console.log(`Testing endpoint: ${endpoint.name}`)
        const response = await fetch(endpoint.url, {
          headers: { Authorization: `Bearer ${token}` }
        })

        results.endpoints[endpoint.name] = {
          status: response.status,
          ok: response.ok
        }

        if (response.ok) {
          const data = await response.json()
          results.endpoints[endpoint.name].dataExists = !!data

          // Add specific field counts based on endpoint
          if (endpoint.name === 'courses' && data.courses) {
            results.endpoints[endpoint.name].count = data.courses.length
          } else if (endpoint.name === 'teacherCourseWork' && data.courseWork) {
            results.endpoints[endpoint.name].count = data.courseWork.length
          } else if (endpoint.name === 'courseWorkMaterials' && data.courseWorkMaterial) {
            results.endpoints[endpoint.name].count = data.courseWorkMaterial.length
          } else if (endpoint.name === 'studentSubmissions' && data.studentSubmissions) {
            results.endpoints[endpoint.name].count = data.studentSubmissions.length
          }
        } else {
          const errorText = await response.text()
          results.endpoints[endpoint.name].error = errorText
        }
      } catch (error) {
        results.endpoints[endpoint.name] = {
          error: error.message
        }
      }
    }

    console.log('Endpoint test results:', results)
    return results
  }
}

const tensorflowService = {
  model: null,
  initialized: false,

  async initialize() {
    console.log('Initializing TensorFlow.js...')

    // Explicitly import both necessary packages
    const tf = await import('@tensorflow/tfjs')
    console.log('TensorFlow core loaded successfully')

    // Import face detection
    const faceDetection = await import('@tensorflow-models/face-detection')
    console.log('Face detection module loaded successfully')

    // Check for valid imports
    if (!faceDetection || !faceDetection.SupportedModels) {
      console.error('Face detection module missing SupportedModels:', faceDetection)
      throw new Error('Face detection module loaded incorrectly')
    }

    // Choose appropriate backend
    if (tf.engine().backendNames().includes('webgl')) {
      await tf.setBackend('webgl')
      console.log('Using WebGL backend')
    } else {
      await tf.setBackend('cpu')
      console.log('Using CPU backend (WebGL not available)')
    }

    // Log available models
    console.log('Available face detection models:', Object.keys(faceDetection.SupportedModels))

    // Create model config - FIXED: Adding the required runtime property
    const modelConfig = {
      runtime: 'tfjs', // Required parameter
      modelType: 'short',
      maxFaces: 1
    }

    // Use MediaPipeFaceDetector instead of BlazeFace
    const modelName = faceDetection.SupportedModels.MediaPipeFaceDetector

    // Make sure model name is valid
    if (!modelName) {
      throw new Error('MediaPipeFaceDetector model not available in SupportedModels')
    }

    console.log('Creating detector with model:', modelName, 'and config:', modelConfig)

    // Create the detector
    const faceDetector = await faceDetection.createDetector(modelName, modelConfig)

    if (!faceDetector) {
      throw new Error('Failed to create face detector')
    }

    console.log('Face detector created successfully')

    // Store the model
    this.model = faceDetector
    this.initialized = true

    return true
  },

  async detectBlinks(videoElement) {
    if (!this.initialized || !this.model) {
      throw new Error('TensorFlow model is not initialized')
    }

    try {
      const predictions = await this.model.estimateFaces(videoElement, false)

      // Check if we have any face detected
      const faceDetected = predictions && predictions.length > 0

      if (!faceDetected) {
        return {
          faceDetected: false,
          isBlinking: false,
          eyeOpenness: 1.0
        }
      }

      // Get the first detected face
      const face = predictions[0]

      // FIXED: Check for keypoints instead of annotations
      // The model might be returning keypoints in different format than expected
      let isBlinking = false
      let eyeOpenness = 1.0

      // Check which properties are actually available
      console.log(
        'Face detection data structure:',
        Object.keys(face).map((key) => `${key}: ${typeof face[key]}`)
      )

      // Try to estimate blinking from what data we have
      if (face.keypoints && Array.isArray(face.keypoints)) {
        // Using keypoints to calculate eye openness
        const leftEyePoints = face.keypoints.filter(
          (kp) =>
            kp.name &&
            kp.name.toLowerCase().includes('eye') &&
            kp.name.toLowerCase().includes('left')
        )

        const rightEyePoints = face.keypoints.filter(
          (kp) =>
            kp.name &&
            kp.name.toLowerCase().includes('eye') &&
            kp.name.toLowerCase().includes('right')
        )

        if (leftEyePoints.length > 1 && rightEyePoints.length > 1) {
          // Find the vertical distance between eye points
          const leftEyeVertical = this.calculateEyeVerticalDistance(leftEyePoints)
          const rightEyeVertical = this.calculateEyeVerticalDistance(rightEyePoints)

          // Average the openness
          eyeOpenness = (leftEyeVertical + rightEyeVertical) / 2

          // Determine if blinking based on threshold
          isBlinking = eyeOpenness < 0.1 // Adjust threshold as needed
        }
      }
      // Fallback if we don't have proper keypoints
      else if (face.box) {
        // If we only have bounding box, we can't determine blinking accurately
        // Just use face detection as a proxy for attention
        eyeOpenness = 0.5 // Neutral value
        isBlinking = false
      }

      return {
        faceDetected: true,
        isBlinking,
        eyeOpenness,
        keypoints: face.keypoints
      }
    } catch (error) {
      console.error('Error in face detection:', error)
      // Return a default response instead of throwing
      return {
        faceDetected: false,
        isBlinking: false,
        eyeOpenness: 1.0,
        error: error.message
      }
    }
  },

  calculateEyeVerticalDistance(eyePoints) {
    if (!eyePoints || eyePoints.length < 2) {
      return 0.5 // Default value if not enough points
    }

    // Find top and bottom points
    let topY = Math.min(...eyePoints.map((p) => p.y))
    let bottomY = Math.max(...eyePoints.map((p) => p.y))

    // Calculate vertical distance relative to face size
    // (A very basic approximation)
    return Math.abs(topY - bottomY) / 20 // Normalize to approximate range
  }
}

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
        await tensorflowService.initialize()
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
              <video id="focus-video" width="420" height="320" autoplay muted playsinline></video>
              <canvas id="focus-overlay" width="420" height="320"></canvas>
              <div class="face-detection-indicator" id="face-indicator">
                <span class="material-icons">face</span>
              </div>
            </div>
          </div>
          
          <div class="focus-stats">
            <div class="focus-score-container">
              <div class="focus-score" id="focus-score-ring">
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
      focusScoreRing: document.getElementById('focus-score-ring'),
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
        tensorflowService
          .initialize()
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
            <div class="session-date">
              <span class="material-icons">event</span> 
              ${formattedDate}, ${formattedTime}
            </div>
            <div class="session-details">
              <div class="session-duration">
                <span class="material-icons">timer</span> ${duration} min
              </div>
              <div class="session-focus">
                <span class="material-icons">psychology</span> Score: ${Math.round(session.attentionScore)}
              </div>
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

      // Start tracking loop - FIXED: Making sure trackFocus is defined properly
      this.trackingInterval = setInterval(() => {
        this.trackFocus().catch((err) => {
          console.error('Error in tracking loop:', err)
        })
      }, 200)

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

    // FIXED: Make sure updateStats is called as a method using 'this'
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
    if (!this.isTracking || !this.modelLoaded) return

    try {
      // Detect faces
      if (!this.videoElement || this.videoElement.readyState < 2) {
        return
      }

      // FIXED: Using the updated detection function that properly handles errors
      const blinkData = await tensorflowService.detectBlinks(this.videoElement)
      const faceDetected = blinkData.faceDetected

      // Update face detection indicator
      this.updateFaceIndicator(faceDetected)

      if (faceDetected) {
        // Draw face on canvas if needed
        if (blinkData.keypoints) {
          this.drawFaceLandmarks(blinkData)
        }

        // Record face detection
        this.focusData.faceDetections.push({
          timestamp: Date.now()
        })

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

      // FIXED: Update stats during tracking
      this.updateStats()
    } catch (error) {
      console.error('Error during focus tracking:', error)
      // Don't throw here, just log the error to avoid breaking the tracking loop
    }
  }

  // FIXED: Added missing functions
  updateFaceIndicator(faceDetected) {
    if (!this.domElements.faceIndicator) return

    this.domElements.faceIndicator.classList.remove('face-detected', 'no-face-detected')

    if (faceDetected) {
      this.domElements.faceIndicator.classList.add('face-detected')
    } else {
      this.domElements.faceIndicator.classList.add('no-face-detected')
    }
  }

  drawFaceLandmarks(faceData) {
    if (!this.canvasContext || !this.canvasElement || !faceData.keypoints) return

    // Clear previous drawing
    this.canvasContext.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height)

    // Draw face landmarks
    this.canvasContext.fillStyle = 'rgba(0, 255, 0, 0.5)'

    faceData.keypoints.forEach((point) => {
      if (point.x && point.y) {
        // Scale points to canvas size
        const x = (point.x * this.canvasElement.width) / this.videoElement.videoWidth
        const y = (point.y * this.canvasElement.height) / this.videoElement.videoHeight

        this.canvasContext.beginPath()
        this.canvasContext.arc(x, y, 2, 0, 2 * Math.PI)
        this.canvasContext.fill()
      }
    })
  }

  recordDistraction() {
    // Check if enough time has passed since the last distraction
    const now = Date.now()
    const lastDistractionTime = this.focusData.lastDistractionTime || 0

    // Only count as a new distraction if more than 3 seconds passed
    if (now - lastDistractionTime > 3000) {
      this.focusData.distractions++
      this.focusData.lastDistractionTime = now

      // Decrease attention score
      this.focusData.attentionScore = Math.max(this.focusData.attentionScore - 5, 0)
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

    // Update the focus score ring visualization
    this.updateFocusRing(score)
  }

  updateFocusRing(score) {
    if (!this.domElements.focusScoreRing) return

    // Update the conic gradient to visualize the score
    const percentage = Math.round(score)
    this.domElements.focusScoreRing.style.background = `conic-gradient(var(--primary-color) 0% ${percentage}%, transparent ${percentage}% 100%)`

    // Change color based on score ranges
    if (percentage >= 80) {
      this.domElements.focusScoreRing.style.setProperty(
        '--primary-color',
        'var(--positive-color, #4cd964)'
      )
    } else if (percentage >= 50) {
      this.domElements.focusScoreRing.style.setProperty(
        '--primary-color',
        'var(--primary-color, #3366ff)'
      )
    } else if (percentage >= 30) {
      this.domElements.focusScoreRing.style.setProperty(
        '--primary-color',
        'var(--warning-color, #ffcc00)'
      )
    } else {
      this.domElements.focusScoreRing.style.setProperty(
        '--primary-color',
        'var(--negative-color, #ff3b30)'
      )
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

    // Update the sessionDuration in the focus data
    this.focusData.sessionDuration = sessionDurationSeconds

    // If session is longer than 10 minutes, offer to take a break every 10 minutes
    if (sessionDurationSeconds > 0 && sessionDurationSeconds % 600 === 0) {
      this.showBreakReminder()
    }
  }

  showBreakReminder() {
    this.showNotification(
      "You've been studying for 10 minutes. Consider taking a short break!",
      'info'
    )
  }

  // FIXED: Added proper implementation of updateStats
  updateStats() {
    if (!this.domElements) return

    // Update focus score display
    if (this.domElements.focusScore) {
      this.domElements.focusScore.textContent = Math.round(this.focusData.attentionScore)
    }

    // Update blink rate display
    if (this.domElements.blinkRate) {
      this.domElements.blinkRate.textContent = Math.round(this.focusData.blinkRate)
    }

    // Update distraction count display
    if (this.domElements.distractionCount) {
      this.domElements.distractionCount.textContent = this.focusData.distractions
    }
  }

  showError(message) {
    if (!this.domElements.errorContainer) return

    this.domElements.errorContainer.textContent = message
    this.domElements.errorContainer.style.display = 'block'

    // Hide after 5 seconds
    setTimeout(() => {
      this.domElements.errorContainer.style.display = 'none'
    }, 5000)

    // Also show as notification
    this.showNotification(message, 'error')
  }

  // FIXED: Added notification system
  showNotification(message, type = 'info') {
    // Create notification element if it doesn't exist
    let notificationElement = document.querySelector('.focus-notification')

    if (!notificationElement) {
      notificationElement = document.createElement('div')
      notificationElement.className = 'focus-notification'
      document.body.appendChild(notificationElement)
    }

    // Set notification content and type
    notificationElement.textContent = message
    notificationElement.className = `focus-notification ${type}`

    // Show notification
    notificationElement.classList.add('show')

    // Hide after a delay
    setTimeout(() => {
      notificationElement.classList.remove('show')

      // Remove from DOM after animation completes
      setTimeout(() => {
        if (document.body.contains(notificationElement)) {
          document.body.removeChild(notificationElement)
        }
      }, 300)
    }, 5000)
  }

  // Export sessions methods
  exportSessions() {
    if (this.savedSessions.length === 0) {
      this.showNotification('No sessions to export', 'warning')
      return
    }

    try {
      // Create a download link for the sessions data
      const sessionsJSON = JSON.stringify(this.savedSessions, null, 2)
      const blob = new Blob([sessionsJSON], { type: 'application/json' })
      const url = URL.createObjectURL(blob)

      const downloadLink = document.createElement('a')
      downloadLink.href = url
      downloadLink.download = `focus-sessions-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(downloadLink)
      downloadLink.click()

      // Clean up
      setTimeout(() => {
        document.body.removeChild(downloadLink)
        URL.revokeObjectURL(url)
      }, 100)

      this.showNotification('Sessions exported successfully', 'success')
    } catch (error) {
      console.error('Error exporting sessions:', error)
      this.showError(`Failed to export sessions: ${error.message}`)
    }
  }

  // Import sessions from a file
  importSessions(event) {
    const fileInput = event.target
    if (!fileInput.files || fileInput.files.length === 0) {
      return
    }

    const file = fileInput.files[0]
    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        const importedSessions = JSON.parse(e.target.result)

        if (!Array.isArray(importedSessions)) {
          throw new Error('Invalid file format: not an array of sessions')
        }

        // Validate basic session structure
        const validSessions = importedSessions.filter(
          (session) =>
            session &&
            typeof session === 'object' &&
            session.startTime &&
            typeof session.attentionScore === 'number'
        )

        if (validSessions.length === 0) {
          throw new Error('No valid sessions found in the file')
        }

        // Merge with existing sessions
        const newSessions = [...this.savedSessions]

        // Add new sessions, avoiding duplicates by ID
        const existingIds = new Set(newSessions.map((s) => s.id))

        validSessions.forEach((session) => {
          if (!session.id) {
            session.id = Date.now() + Math.floor(Math.random() * 1000)
          }

          if (!existingIds.has(session.id)) {
            newSessions.push(session)
            existingIds.add(session.id)
          }
        })

        // Sort by date and limit to 50 sessions
        this.savedSessions = newSessions
          .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
          .slice(0, 50)

        // Save to localStorage
        this.saveSessions()

        // Update UI
        this.updateSessionsList()

        this.showNotification(`Imported ${validSessions.length} sessions successfully`, 'success')

        // Reset the file input
        fileInput.value = ''
      } catch (error) {
        console.error('Error importing sessions:', error)
        this.showError(`Failed to import sessions: ${error.message}`)

        // Reset the file input
        fileInput.value = ''
      }
    }

    reader.onerror = () => {
      this.showError('Error reading the file')
      fileInput.value = ''
    }

    reader.readAsText(file)
  }

  // Generate summary for a completed session
  generateSessionSummary() {
    if (!this.focusData.endTime) {
      return null
    }

    const sessionDurationMinutes = this.focusData.sessionDuration / 60
    const avgAttentionScore = this.calculateAverageAttentionScore()
    const totalBlinks = this.focusData.blinkEvents.length
    const blinkRate = sessionDurationMinutes > 0 ? totalBlinks / sessionDurationMinutes : 0

    let focusQuality = 'Poor'
    if (avgAttentionScore >= 85) focusQuality = 'Excellent'
    else if (avgAttentionScore >= 70) focusQuality = 'Good'
    else if (avgAttentionScore >= 50) focusQuality = 'Fair'

    // Generate personalized suggestions
    const suggestions = this.generateSuggestions(
      avgAttentionScore,
      blinkRate,
      this.focusData.distractions
    )

    return {
      date: new Date().toLocaleDateString(),
      startTime: new Date(this.focusData.startTime).toLocaleTimeString(),
      endTime: new Date(this.focusData.endTime).toLocaleTimeString(),
      duration: `${Math.floor(sessionDurationMinutes)} minutes`,
      attentionScore: Math.round(avgAttentionScore),
      blinkRate: Math.round(blinkRate),
      distractions: this.focusData.distractions,
      focusQuality: focusQuality,
      suggestions: suggestions
    }
  }

  calculateAverageAttentionScore() {
    if (this.focusData.focusScoreHistory.length === 0) {
      return this.focusData.attentionScore
    }

    const sum = this.focusData.focusScoreHistory.reduce((total, record) => {
      return total + record.score
    }, 0)

    return sum / this.focusData.focusScoreHistory.length
  }

  generateSuggestions(attentionScore, blinkRate, distractions) {
    const suggestions = []

    if (attentionScore < 50) {
      suggestions.push(
        'Your focus was relatively low. Try the Pomodoro technique: 25 minutes of focused work followed by a 5-minute break.'
      )
    }

    if (blinkRate > 25) {
      suggestions.push(
        'Your high blink rate may indicate eye fatigue. Consider the 20-20-20 rule: every 20 minutes, look at something 20 feet away for 20 seconds.'
      )
    } else if (blinkRate < 10 && blinkRate > 0) {
      suggestions.push(
        'Your low blink rate may cause eye strain. Remember to blink regularly when working on screens.'
      )
    }

    if (distractions > 5) {
      suggestions.push(
        'You had many distractions. Consider using a dedicated study space with fewer interruptions.'
      )
    }

    // Add a general suggestion if none were generated
    if (suggestions.length === 0) {
      suggestions.push(
        'Great focus session! For even better results, try drinking water regularly and taking short breaks every 25-30 minutes.'
      )
    }

    return suggestions
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

async function initializeFocusTracking() {
  const focusContainer = document.getElementById('focus-tracking-container')
  if (!focusContainer) {
    console.error('Focus tracking container not found')
    return
  }

  // Create focus tracker if not exists
  if (!window.focusTracker) {
    // Define the tensorflowService object with fixed implementation
    window.tensorflowService = {
      model: null,
      initialized: false,

      async initialize() {
        console.log('Initializing TensorFlow.js...')

        try {
          // Explicitly import both necessary packages
          const tf = await import('@tensorflow/tfjs')
          console.log('TensorFlow core loaded successfully')

          // Import face detection
          const faceDetection = await import('@tensorflow-models/face-detection')
          console.log('Face detection module loaded successfully')

          // Choose appropriate backend
          if (tf.engine().backendNames().includes('webgl')) {
            await tf.setBackend('webgl')
            console.log('Using WebGL backend')
          } else {
            await tf.setBackend('cpu')
            console.log('Using CPU backend (WebGL not available)')
          }

          // Create model config
          const modelConfig = {
            runtime: 'tfjs', // Required parameter
            modelType: 'short',
            maxFaces: 1
          }

          // Use MediaPipeFaceDetector if available
          const modelName = faceDetection.SupportedModels.MediaPipeFaceDetector

          // Create the detector
          const faceDetector = await faceDetection.createDetector(modelName, modelConfig)

          // Store the model
          this.model = faceDetector
          this.initialized = true

          console.log('Face detector created successfully')
          return true
        } catch (error) {
          console.error('Failed to initialize TensorFlow:', error)
          throw error
        }
      },

      async detectBlinks(videoElement) {
        if (!this.initialized || !this.model) {
          throw new Error('TensorFlow model is not initialized')
        }

        try {
          const predictions = await this.model.estimateFaces(videoElement, false)

          // Check if we have any face detected
          const faceDetected = predictions && predictions.length > 0

          if (!faceDetected) {
            return {
              faceDetected: false,
              isBlinking: false,
              eyeOpenness: 1.0
            }
          }

          // Get the first detected face
          const face = predictions[0]

          // Use keypoints instead of annotations
          let isBlinking = false
          let eyeOpenness = 1.0

          // Try to estimate blinking from keypoints if available
          if (face.keypoints && Array.isArray(face.keypoints)) {
            const leftEyePoints = face.keypoints.filter(
              (kp) =>
                kp.name &&
                kp.name.toLowerCase().includes('eye') &&
                kp.name.toLowerCase().includes('left')
            )

            const rightEyePoints = face.keypoints.filter(
              (kp) =>
                kp.name &&
                kp.name.toLowerCase().includes('eye') &&
                kp.name.toLowerCase().includes('right')
            )

            if (leftEyePoints.length > 1 && rightEyePoints.length > 1) {
              // Calculate vertical distance between eye points
              const calculateEyeVerticalDistance = (points) => {
                let topY = Math.min(...points.map((p) => p.y))
                let bottomY = Math.max(...points.map((p) => p.y))
                return Math.abs(topY - bottomY) / 20 // Normalize
              }

              const leftEyeVertical = calculateEyeVerticalDistance(leftEyePoints)
              const rightEyeVertical = calculateEyeVerticalDistance(rightEyePoints)

              // Average the openness
              eyeOpenness = (leftEyeVertical + rightEyeVertical) / 2

              // Determine if blinking based on threshold
              isBlinking = eyeOpenness < 0.1 // Adjust threshold as needed
            }
          }
          // Fallback if we don't have proper keypoints
          else if (face.box) {
            // If we only have bounding box, we can't determine blinking accurately
            eyeOpenness = 0.5 // Neutral value
            isBlinking = false
          }

          return {
            faceDetected: true,
            isBlinking,
            eyeOpenness,
            keypoints: face.keypoints
          }
        } catch (error) {
          console.error('Error in face detection:', error)
          // Return a default response instead of throwing
          return {
            faceDetected: false,
            isBlinking: false,
            eyeOpenness: 1.0,
            error: error.message
          }
        }
      }
    }

    // Create the FocusTracker instance
    window.focusTracker = new FocusTracker()
    await window.focusTracker.initialize(focusContainer)
  }
}

// Define a simple cameraService if it doesn't exist
if (!window.cameraService) {
  window.cameraService = {
    stream: null,
    videoElement: null,

    async initialize(videoElement) {
      this.videoElement = videoElement

      try {
        // Request camera permission and access
        const constraints = {
          video: {
            facingMode: 'user',
            width: { ideal: 640 },
            height: { ideal: 480 }
          }
        }

        this.stream = await navigator.mediaDevices.getUserMedia(constraints)

        // Connect stream to video element
        this.videoElement.srcObject = this.stream

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
    },

    stop() {
      if (this.stream) {
        this.stream.getTracks().forEach((track) => track.stop())
        this.stream = null
      }

      if (this.videoElement) {
        this.videoElement.srcObject = null
      }
    }
  }
}

// Initialize focus tracking when the focus section is shown
document.querySelector('.nav-btn[data-section="focus"]')?.addEventListener('click', () => {
  initializeFocusTracking().catch((error) => {
    console.error('Failed to initialize focus tracking:', error)
    alert(`Error initializing focus tracking: ${error.message}`)
  })
})

// Also initialize on page load if we're already on the focus section
document.addEventListener('DOMContentLoaded', () => {
  const focusSection = document.getElementById('focus-section')
  if (focusSection && focusSection.classList.contains('active')) {
    initializeFocusTracking().catch((error) => {
      console.error('Failed to initialize focus tracking on page load:', error)
    })
  }
})

// For debugging - print some useful information
console.log('Debug Info:')
console.log('- TensorFlow.js available:', typeof window.tf !== 'undefined')
console.log('- Face detection available:', typeof window.faceDetection !== 'undefined')
console.log(
  '- Camera API available:',
  !!navigator.mediaDevices && !!navigator.mediaDevices.getUserMedia
)

// Button to manually retry initialization if needed
document.getElementById('retry-focus-init')?.addEventListener('click', () => {
  window.focusTracker = null // Reset for fresh initialization
  initializeFocusTracking().catch((error) => {
    console.error('Failed to initialize focus tracking on retry:', error)
    alert(`Error initializing focus tracking: ${error.message}`)
  })
})

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

function calculateEnhancedComplexity(work) {
  let complexity = 0

  // Base complexity by work type with more nuanced values
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
    case 'MATERIAL':
      complexity = 2
      break
    case 'ANNOUNCEMENT':
      complexity = 1
      break
    default:
      complexity = 2
  }

  // Consider description length as an indicator of complexity
  if (work.description) {
    complexity += Math.min(work.description.length / 200, 3)

    // Look for keywords that indicate complexity
    const complexityKeywords = [
      'analyze',
      'synthesis',
      'evaluate',
      'complex',
      'challenging',
      'difficult',
      'comprehensive',
      'research',
      'investigation'
    ]

    complexityKeywords.forEach((keyword) => {
      if (work.description.toLowerCase().includes(keyword)) {
        complexity += 0.5
      }
    })
  }

  // Consider title length and keywords
  if (work.title) {
    // Check for keywords in title that indicate difficulty
    const titleKeywords = ['final', 'exam', 'midterm', 'project', 'paper', 'essay']
    titleKeywords.forEach((keyword) => {
      if (work.title.toLowerCase().includes(keyword)) {
        complexity += 0.7
      }
    })
  }

  // Adjust for material types
  if (work.materials) {
    // More materials generally means more complexity
    complexity += Math.min(work.materials.length * 0.3, 1.5)

    // Check for complex material types (videos take more time than links)
    work.materials.forEach((material) => {
      if (material.youtubeVideo) complexity += 0.5
      if (material.driveFile) complexity += 0.3
      if (material.form) complexity += 0.4
    })
  }

  // Normalize to 0-1 range
  return Math.min(complexity / 10, 1)
}

function estimateTimeRequiredEnhanced(work) {
  let baseTime = 0 // in hours

  // Base time by work type with more nuanced values
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
    case 'MATERIAL':
      baseTime = 0.75
      break
    case 'ANNOUNCEMENT':
      baseTime = 0.1
      break
    default:
      baseTime = 1
  }

  // Consider description length for time estimate
  if (work.description) {
    // More text generally means more time needed
    baseTime += Math.min(work.description.length / 500, 1)

    // Look for keywords that might indicate time requirements
    if (work.description.match(/\b(\d+)\s*(?:hour|hr|hours)\b/i)) {
      const match = work.description.match(/\b(\d+)\s*(?:hour|hr|hours)\b/i)
      if (match && match[1]) {
        const explicitHours = parseInt(match[1])
        // Use explicit time if mentioned, but cap it reasonably
        if (explicitHours > 0 && explicitHours < 20) {
          baseTime = Math.max(baseTime, explicitHours)
        }
      }
    }
  }

  // Consider materials
  if (work.materials) {
    work.materials.forEach((material) => {
      if (material.youtubeVideo) {
        // Videos take their duration plus some for note-taking
        baseTime += 0.5 // Assume average 30 minutes per video
      } else if (material.driveFile) {
        baseTime += 0.3 // Reading files
      } else if (material.link) {
        baseTime += 0.2 // External links
      }
    })
  }

  // Normalize to 0-1 range for the algorithm (max 10 hours)
  return Math.min(baseTime / 10, 1)
}

function calculateDueWindowEnhanced(work) {
  if (!work.dueDate) {
    return 0.85 // Default for no due date (not too urgent, not too far)
  }

  const today = new Date()
  const dueDate = createDateFromDueDate(work.dueDate)

  // Calculate days until due
  const diffTime = dueDate - today
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

  // Apply a logarithmic scale for better distribution
  // 0 = due today (very urgent), 1 = due far in future (not urgent)
  if (diffDays <= 0) {
    // Overdue or due today
    return 0
  } else if (diffDays === 1) {
    // Due tomorrow
    return 0.1
  } else if (diffDays <= 3) {
    // Due in 2-3 days
    return 0.3
  } else if (diffDays <= 7) {
    // Due within a week
    return 0.5
  } else if (diffDays <= 14) {
    // Due within two weeks
    return 0.7
  } else {
    // Due in more than two weeks
    return 0.9
  }
}

function calculatePriorityEnhanced(work, complexity, dueWindow, course) {
  // Base priority calculation
  let priority = complexity * 0.3 + (1 - dueWindow) * 0.6

  // Adjust priority based on work type
  switch (work.workType) {
    case 'TEST':
      priority += 0.15 // Tests are high priority
      break
    case 'QUIZ':
      priority += 0.1 // Quizzes are medium-high priority
      break
    case 'ASSIGNMENT':
      priority += 0.05 // Assignments are medium priority
      break
    case 'MATERIAL':
      priority -= 0.05 // Materials are slightly lower priority unless needed for an assignment
      break
    case 'ANNOUNCEMENT':
      priority -= 0.1 // Announcements are lower priority for study purposes
      break
  }

  // Check title for important keywords
  if (work.title) {
    const importantKeywords = ['final', 'midterm', 'exam', 'project', 'deadline', 'important']
    importantKeywords.forEach((keyword) => {
      if (work.title.toLowerCase().includes(keyword)) {
        priority += 0.05 // Increase priority for important assignments
      }
    })
  }

  // Cap priority between 0 and 1
  return Math.max(0, Math.min(priority, 1))
}

function identifyKnowledgeArea(work, course) {
  // Extract subject areas from course name and work title/description
  const subjectKeywords = {
    math: ['calculus', 'algebra', 'mathematics', 'equation', 'theorem', 'math'],
    science: ['biology', 'chemistry', 'physics', 'scientific', 'experiment', 'lab'],
    history: ['history', 'historical', 'century', 'civilization', 'era'],
    language: ['english', 'spanish', 'french', 'grammar', 'vocabulary', 'literature'],
    art: ['art', 'design', 'creative', 'drawing', 'painting'],
    technology: ['computer', 'programming', 'code', 'software', 'hardware', 'technology'],
    social: ['psychology', 'sociology', 'social', 'society', 'community']
  }

  // Default knowledge area
  let area = 'general'
  let highestMatchCount = 0

  // Check course name first
  Object.entries(subjectKeywords).forEach(([subject, keywords]) => {
    let matchCount = 0
    keywords.forEach((keyword) => {
      if (course.name.toLowerCase().includes(keyword)) {
        matchCount++
      }
    })

    if (work.title) {
      keywords.forEach((keyword) => {
        if (work.title.toLowerCase().includes(keyword)) {
          matchCount++
        }
      })
    }

    if (work.description) {
      keywords.forEach((keyword) => {
        if (work.description.toLowerCase().includes(keyword)) {
          matchCount++
        }
      })
    }

    if (matchCount > highestMatchCount) {
      highestMatchCount = matchCount
      area = subject
    }
  })

  return area
}

function identifyPrerequisites(work, course, allFeatures) {
  const prerequisites = []

  // Check for explicit prerequisites in the title or description
  const prerequisiteKeywords = [
    'prerequisite',
    'required',
    'before',
    'prior',
    'complete',
    'finish',
    'based on',
    'continuation',
    'part 2',
    'follow-up'
  ]

  if (work.title) {
    const titleLower = work.title.toLowerCase()
    // Check for numeric sequences (like "Chapter 2" that would come after "Chapter 1")
    const chapterMatch = titleLower.match(/chapter\s+(\d+)/i)
    const partMatch = titleLower.match(/part\s+(\d+)/i)
    const unitMatch = titleLower.match(/unit\s+(\d+)/i)

    if (chapterMatch && chapterMatch[1] && parseInt(chapterMatch[1]) > 1) {
      // Look for previous chapters
      const chapterNum = parseInt(chapterMatch[1])
      const prevChapterNum = chapterNum - 1

      // Find previous chapter in same course
      allFeatures.forEach((feature) => {
        if (
          feature.courseId === course.id &&
          feature.workTitle &&
          feature.workTitle.toLowerCase().includes(`chapter ${prevChapterNum}`)
        ) {
          prerequisites.push(feature.workId)
        }
      })
    }

    // Similar logic for parts
    if (partMatch && partMatch[1] && parseInt(partMatch[1]) > 1) {
      const partNum = parseInt(partMatch[1])
      const prevPartNum = partNum - 1

      allFeatures.forEach((feature) => {
        if (
          feature.courseId === course.id &&
          feature.workTitle &&
          feature.workTitle.toLowerCase().includes(`part ${prevPartNum}`)
        ) {
          prerequisites.push(feature.workId)
        }
      })
    }

    // And for units
    if (unitMatch && unitMatch[1] && parseInt(unitMatch[1]) > 1) {
      const unitNum = parseInt(unitMatch[1])
      const prevUnitNum = unitNum - 1

      allFeatures.forEach((feature) => {
        if (
          feature.courseId === course.id &&
          feature.workTitle &&
          feature.workTitle.toLowerCase().includes(`unit ${prevUnitNum}`)
        ) {
          prerequisites.push(feature.workId)
        }
      })
    }
  }

  if (work.description) {
    // Look for references to other assignments
    prerequisiteKeywords.forEach((keyword) => {
      if (work.description.toLowerCase().includes(keyword)) {
        // Simple heuristic: if a prerequisite keyword appears close to another assignment name
        // from the same course, consider it a prerequisite
        allFeatures.forEach((feature) => {
          if (
            feature.courseId === course.id &&
            feature.workId !== work.id &&
            feature.workTitle &&
            work.description.includes(feature.workTitle)
          ) {
            prerequisites.push(feature.workId)
          }
        })
      }
    })
  }

  return prerequisites
}

// Extract features from course data for AI-based curriculum generation
function extractFeaturesFromCourseData(courses) {
  return courses.reduce((allFeatures, course) => {
    if (!course.courseWork || course.courseWork.length === 0) {
      return allFeatures
    }

    const courseFeatures = course.courseWork.map((work) => {
      // Calculate assignment complexity with more factors
      const complexityScore = calculateEnhancedComplexity(work)

      // Better time estimation based on work type, content, and keywords
      const timeRequired = estimateTimeRequiredEnhanced(work)

      // More sophisticated due window calculation
      const dueWindow = calculateDueWindowEnhanced(work)

      // Enhanced priority calculation that considers more factors
      const priorityLevel = calculatePriorityEnhanced(work, complexityScore, dueWindow, course)

      // Identify knowledge area and prerequisites
      const knowledgeArea = identifyKnowledgeArea(work, course)
      const prerequisites = identifyPrerequisites(work, course, allFeatures)

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
        knowledgeArea,
        prerequisites,
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
    // Extract features from course data with more sophisticated analysis
    const features = extractFeaturesFromCourseData(coursesData)

    if (features.length === 0) {
      return { success: false, message: 'No course work available to generate curriculum' }
    }

    // Enhanced preferences with better defaults
    const preferences = {
      preferredDifficulty: 0.5, // Medium difficulty
      availableHoursPerDay: 2, // Default 2 hours/day
      availableHoursPerWeek: 10, // Default 10 hours/week
      prioritizeDeadlines: true,
      includeWeekends: false,
      preferredTimeOfDay: 'afternoon',
      breakDuration: 5, // minutes between study sessions
      pomodoroDuration: 25, // minutes per study session
      ...userPreferences
    }

    // Calculate learning style based on focus sessions
    const learningStyle = analyzeLearningStyle(focusSessions)

    // Create or load the model for optimization
    const optimizedPlan = optimizeStudyPlan(features, preferences, learningStyle)

    // Create a weekly schedule with improved distribution algorithm
    const weeklySchedule = createEnhancedWeeklySchedule(optimizedPlan, coursesData, preferences)

    // Calculate additional insights for the student
    const insights = generateLearningInsights(optimizedPlan, focusSessions)

    return {
      success: true,
      weeklySchedule,
      totalAssignments: features.length,
      totalEstimatedHours: calculateTotalHours(optimizedPlan),
      courseBreakdown: calculateCourseBreakdown(optimizedPlan),
      learningStyle,
      insights
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
function optimizeStudyPlan(features, preferences, learningStyle) {
  // Sort features by priority first
  let sortedFeatures = [...features]

  // Apply learning style adaptations
  if (learningStyle === 'visual') {
    // Visual learners may prefer to tackle visual materials first
    sortedFeatures.sort((a, b) => {
      // Check if material has visual elements
      const aVisual =
        a.originalWork &&
        a.originalWork.materials &&
        a.originalWork.materials.some(
          (m) => m.youtubeVideo || (m.driveFile && m.driveFile.includes('image'))
        )
      const bVisual =
        b.originalWork &&
        b.originalWork.materials &&
        b.originalWork.materials.some(
          (m) => m.youtubeVideo || (m.driveFile && m.driveFile.includes('image'))
        )

      // Prioritize visual materials for visual learners
      if (aVisual && !bVisual) return -1
      if (!aVisual && bVisual) return 1

      // Fall back to priority
      return b.priorityLevel - a.priorityLevel
    })
  } else if (learningStyle === 'sequential') {
    // Sequential learners prefer logical ordering
    // Sort by prerequisites first, then by due date
    sortedFeatures = topologicalSort(sortedFeatures)
  } else {
    // Default sorting by priority level
    sortedFeatures.sort((a, b) => {
      // Prioritize high priority items
      if (Math.abs(b.priorityLevel - a.priorityLevel) > 0.2) {
        return b.priorityLevel - a.priorityLevel
      }

      // If priorities are similar, prioritize by due date
      if (a.dueDate && b.dueDate) {
        return a.dueDate - b.dueDate
      }

      // If only one has a due date, prioritize it
      if (a.dueDate) return -1
      if (b.dueDate) return 1

      // If neither has a due date, order by complexity based on preference
      if (preferences.preferredDifficulty >= 0.5) {
        // Prefer more complex assignments for those who like challenge
        return b.assignmentComplexity - a.assignmentComplexity
      } else {
        // Prefer less complex assignments for those who prefer easier material
        return a.assignmentComplexity - b.assignmentComplexity
      }
    })
  }

  // Group similar knowledge areas together when possible
  const groupedByKnowledgeArea = groupByKnowledgeArea(sortedFeatures)

  // Finally, balance workload
  return balanceWorkload(groupedByKnowledgeArea, preferences)
}

function topologicalSort(features) {
  // Create a graph of prerequisites
  const graph = {}
  const result = []
  const visited = new Set()
  const temp = new Set() // For cycle detection

  // Initialize graph
  features.forEach((feature) => {
    graph[feature.workId] = {
      prerequisites: feature.prerequisites || [],
      feature: feature
    }
  })

  // Define DFS function for topological sort
  const visit = (nodeId) => {
    if (temp.has(nodeId)) {
      // We have a cycle, break it
      return
    }

    if (visited.has(nodeId)) {
      return
    }

    temp.add(nodeId)

    // Visit prerequisites first
    const node = graph[nodeId]
    if (node && node.prerequisites) {
      node.prerequisites.forEach((prereqId) => {
        if (graph[prereqId]) {
          visit(prereqId)
        }
      })
    }

    temp.delete(nodeId)
    visited.add(nodeId)

    // Add to result (prerequisites come before their dependents)
    if (node) {
      result.unshift(node.feature)
    }
  }

  // Start DFS from each node
  features.forEach((feature) => {
    if (!visited.has(feature.workId)) {
      visit(feature.workId)
    }
  })

  return result
}

function groupByKnowledgeArea(features) {
  // Initialize groups
  const groups = {}

  // Group features by knowledge area
  features.forEach((feature) => {
    if (!groups[feature.knowledgeArea]) {
      groups[feature.knowledgeArea] = []
    }
    groups[feature.knowledgeArea].push(feature)
  })

  // Flatten while preserving ordering within groups
  const result = []

  // Process groups in order of priorities
  const orderedAreas = Object.keys(groups).sort((a, b) => {
    // Calculate average priority for each area
    const avgPriorityA = groups[a].reduce((sum, f) => sum + f.priorityLevel, 0) / groups[a].length
    const avgPriorityB = groups[b].reduce((sum, f) => sum + f.priorityLevel, 0) / groups[b].length

    return avgPriorityB - avgPriorityA
  })

  // Add all groups in order
  orderedAreas.forEach((area) => {
    result.push(...groups[area])
  })

  return result
}

function balanceWorkload(features, preferences) {
  // Calculate total estimated time
  const totalHours = features.reduce((total, feature) => {
    return total + feature.timeRequired * 10 // Convert back from normalized value
  }, 0)

  // Calculate days needed based on preferences
  const daysNeeded = Math.ceil(totalHours / preferences.availableHoursPerDay)

  // Distribute features across days to balance workload
  const balancedFeatures = []
  const dayWorkloads = Array(daysNeeded).fill(0)

  // Sort by time required (descending) to place largest tasks first
  const sortedByTime = [...features].sort((a, b) => b.timeRequired * 10 - a.timeRequired * 10)

  // Place each feature on the day with the least workload
  sortedByTime.forEach((feature) => {
    // Find day with minimum workload
    const minDay = dayWorkloads.indexOf(Math.min(...dayWorkloads))

    // Assign day to feature
    feature.assignedDay = minDay

    // Update workload
    dayWorkloads[minDay] += feature.timeRequired * 10

    balancedFeatures.push(feature)
  })

  // Resort by day and priority within each day
  return balancedFeatures.sort((a, b) => {
    if (a.assignedDay !== b.assignedDay) {
      return a.assignedDay - b.assignedDay
    }

    return b.priorityLevel - a.priorityLevel
  })
}

function createEnhancedWeeklySchedule(studyPlan, coursesData, preferences) {
  const weeklySchedule = []
  const daysOfWeek = preferences.includeWeekends ? 7 : 5

  // Initialize schedule for 4 weeks (28 days)
  const totalDays = 28
  const today = new Date()

  // Pre-process study plan to compute day assignments
  const dayAssignments = Array(totalDays)
    .fill()
    .map(() => [])

  // Assign each item to its day
  studyPlan.forEach((assignment, index) => {
    // Use assigned day from balanced workload if available
    const day =
      assignment.assignedDay !== undefined
        ? assignment.assignedDay
        : Math.floor(index / Math.ceil(studyPlan.length / totalDays))

    if (day < totalDays) {
      dayAssignments[day].push(assignment)
    }
  })

  // Build the weekly schedule
  for (let week = 0; week < 4; week++) {
    const weekStart = new Date(today)
    weekStart.setDate(weekStart.getDate() + week * 7)

    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 6)

    const weekSchedule = {
      week: week + 1,
      startDate: weekStart,
      endDate: weekEnd,
      totalHours: 0,
      days: []
    }

    // Initialize days for the week
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
      const dayDate = new Date(weekStart)
      dayDate.setDate(dayDate.getDate() + dayOfWeek)

      // Skip weekends if not included in preferences
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6

      const daySchedule = {
        day: dayOfWeek,
        date: dayDate,
        isWeekend,
        assignments: []
      }

      // Skip assignment allocation for weekends if not included
      if (!isWeekend || preferences.includeWeekends) {
        const dayIndex = week * 7 + dayOfWeek

        if (dayIndex < totalDays && dayAssignments[dayIndex].length > 0) {
          // Add assignments for this day
          dayAssignments[dayIndex].forEach((assignment) => {
            const estimatedHours = assignment.timeRequired * 10 // Convert from normalized value

            daySchedule.assignments.push({
              id: assignment.workId,
              title: assignment.workTitle,
              courseId: assignment.courseId,
              courseName: assignment.courseName,
              estimatedHours,
              dueDate: assignment.dueDate,
              type: assignment.type || assignment.workType,
              complexity: assignment.assignmentComplexity,
              knowledgeArea: assignment.knowledgeArea,
              prerequisites: assignment.prerequisites
            })

            weekSchedule.totalHours += estimatedHours
          })
        }
      }

      weekSchedule.days.push(daySchedule)
    }

    weeklySchedule.push(weekSchedule)
  }

  return weeklySchedule
}

function analyzeLearningStyle(focusSessions) {
  if (!focusSessions || focusSessions.length === 0) {
    return 'balanced' // Default
  }

  // Calculate average session duration
  const avgDuration =
    focusSessions.reduce((sum, session) => {
      const duration = (session.endTime - session.startTime) / (1000 * 60) // minutes
      return sum + duration
    }, 0) / focusSessions.length

  // Calculate average attention score
  const avgAttention =
    focusSessions.reduce((sum, session) => sum + session.attentionScore, 0) / focusSessions.length

  // Calculate blink patterns
  const avgBlinkRate =
    focusSessions.reduce((sum, session) => sum + (session.blinkRate || 0), 0) / focusSessions.length

  // Determine learning style based on study patterns
  if (avgDuration > 45 && avgAttention > 75) {
    return 'deep' // Deep learner - long focused sessions
  } else if (avgDuration < 30 && avgBlinkRate > 20) {
    return 'visual' // Visual learner - shorter sessions, higher blink rate
  } else if (avgAttention < 60 && avgBlinkRate < 15) {
    return 'kinesthetic' // Kinesthetic learner - may need more movement
  } else if (avgDuration > 35 && avgBlinkRate < 15) {
    return 'sequential' // Sequential learner - steady focus
  } else {
    return 'balanced' // Balanced learner
  }
}

// Function to generate personalized learning insights based on focus data
function generateLearningInsights(studyPlan, focusSessions) {
  const insights = []

  // Calculate study pattern metrics
  if (focusSessions && focusSessions.length > 0) {
    // Calculate optimal study time based on past performance
    const sessionsByHour = Array(24).fill(0)
    const scoresByHour = Array(24).fill(0)

    focusSessions.forEach((session) => {
      const startHour = new Date(session.startTime).getHours()
      sessionsByHour[startHour]++
      scoresByHour[startHour] += session.attentionScore
    })

    // Find hours with highest average focus score
    const avgScoresByHour = scoresByHour.map((score, hour) =>
      sessionsByHour[hour] > 0 ? score / sessionsByHour[hour] : 0
    )

    // Find best study hours (top 3)
    const bestHours = avgScoresByHour
      .map((score, hour) => ({ hour, score }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)

    if (bestHours.length > 0) {
      insights.push({
        type: 'optimal_time',
        title: 'Best Study Times',
        description: `Your focus data shows you perform best when studying at: ${bestHours
          .map((h) => `${h.hour}:00${h.hour < 12 ? 'am' : 'pm'}`)
          .join(', ')}`,
        data: bestHours
      })
    }

    // Calculate optimal session duration
    const sessionsByDuration = {}
    focusSessions.forEach((session) => {
      const durationMinutes =
        Math.round((session.endTime - session.startTime) / (1000 * 60) / 10) * 10
      if (!sessionsByDuration[durationMinutes]) {
        sessionsByDuration[durationMinutes] = {
          count: 0,
          totalScore: 0
        }
      }
      sessionsByDuration[durationMinutes].count++
      sessionsByDuration[durationMinutes].totalScore += session.attentionScore
    })

    // Find optimal duration
    let optimalDuration = 25 // Default Pomodoro
    let bestScore = 0

    Object.entries(sessionsByDuration).forEach(([duration, data]) => {
      const avgScore = data.totalScore / data.count
      if (data.count >= 2 && avgScore > bestScore) {
        bestScore = avgScore
        optimalDuration = parseInt(duration)
      }
    })

    insights.push({
      type: 'optimal_duration',
      title: 'Ideal Study Session Duration',
      description: `Your focus data suggests that ${optimalDuration}-minute sessions work best for you.`,
      data: { duration: optimalDuration, score: bestScore }
    })

    // Calculate blink rate patterns and make recommendations
    const avgBlinkRate =
      focusSessions.reduce((sum, session) => sum + (session.blinkRate || 0), 0) /
      focusSessions.length

    if (avgBlinkRate > 25) {
      insights.push({
        type: 'eye_strain',
        title: 'Potential Eye Strain Detected',
        description:
          'Your high blink rate may indicate eye fatigue. Consider the 20-20-20 rule: every 20 minutes, look at something 20 feet away for 20 seconds.',
        data: { blinkRate: avgBlinkRate }
      })
    } else if (avgBlinkRate < 10) {
      insights.push({
        type: 'eye_focus',
        title: 'Remember to Blink',
        description:
          'Your low blink rate may cause eye strain. Remember to blink regularly when working on screens.',
        data: { blinkRate: avgBlinkRate }
      })
    }

    // Calculate distraction patterns
    const avgDistractions =
      focusSessions.reduce((sum, session) => sum + (session.distractions || 0), 0) /
      focusSessions.length

    if (avgDistractions > 5) {
      insights.push({
        type: 'distraction',
        title: 'Distraction Management',
        description:
          'You experienced many distractions during your study sessions. Consider using a dedicated study space with fewer interruptions.',
        data: { avgDistractions }
      })
    }

    // Calculate optimal assignment difficulty based on performance
    const avgAttentionScore =
      focusSessions.reduce((sum, session) => sum + session.attentionScore, 0) / focusSessions.length

    // Adjust study plan based on optimal difficulty
    if (avgAttentionScore > 80) {
      // Suggest more challenging work first
      insights.push({
        type: 'difficulty',
        title: 'Optimal Difficulty Level',
        description:
          'Your high focus scores indicate you perform well with challenging material. Your study plan prioritizes more complex assignments first to maximize your productivity.',
        data: { avgAttentionScore }
      })
    } else if (avgAttentionScore < 60) {
      // Suggest easier work first to build momentum
      insights.push({
        type: 'difficulty',
        title: 'Recommended Study Approach',
        description:
          "Based on your focus patterns, we've arranged your study plan to start with more accessible material to build momentum before tackling more challenging assignments.",
        data: { avgAttentionScore }
      })
    }

    // Analyze work patterns and make recommendations
    const dayOfWeekDistribution = Array(7).fill(0)
    const scoresByDay = Array(7).fill(0)

    focusSessions.forEach((session) => {
      const dayOfWeek = new Date(session.startTime).getDay() // 0 = Sunday
      dayOfWeekDistribution[dayOfWeek]++
      scoresByDay[dayOfWeek] += session.attentionScore
    })

    // Calculate average score by day
    const avgScoresByDay = scoresByDay.map((score, day) =>
      dayOfWeekDistribution[day] > 0 ? score / dayOfWeekDistribution[day] : 0
    )

    // Find best day for studying
    const bestDayIndex = avgScoresByDay.indexOf(Math.max(...avgScoresByDay))
    const bestDay = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
      bestDayIndex
    ]

    if (avgScoresByDay[bestDayIndex] > 0) {
      insights.push({
        type: 'optimal_day',
        title: 'Best Day for Deep Work',
        description: `${bestDay} appears to be your most productive day based on focus metrics. Consider scheduling your most challenging work on this day.`,
        data: { day: bestDay, score: avgScoresByDay[bestDayIndex] }
      })
    }
  }

  // Study plan specific insights
  if (studyPlan && studyPlan.length > 0) {
    // Identify knowledge gap areas
    const courseWorkByType = {}
    studyPlan.forEach((item) => {
      if (!courseWorkByType[item.workType]) {
        courseWorkByType[item.workType] = []
      }
      courseWorkByType[item.workType].push(item)
    })

    // Course distribution analysis
    const courseDistribution = {}
    studyPlan.forEach((item) => {
      if (!courseDistribution[item.courseName]) {
        courseDistribution[item.courseName] = 0
      }
      courseDistribution[item.courseName]++
    })

    // Find course with most pending work
    const mostWorkCourse = Object.entries(courseDistribution).sort((a, b) => b[1] - a[1])[0]

    if (mostWorkCourse) {
      insights.push({
        type: 'course_focus',
        title: 'Course Focus Area',
        description: `${mostWorkCourse[0]} requires the most attention with ${mostWorkCourse[1]} pending assignments. We've optimized your schedule to balance this workload.`,
        data: { course: mostWorkCourse[0], count: mostWorkCourse[1] }
      })
    }

    // Find assignment deadlines clusters
    const deadlineClusters = {}
    studyPlan.forEach((item) => {
      if (item.dueDate) {
        const dateStr = item.dueDate.toISOString().split('T')[0]
        if (!deadlineClusters[dateStr]) {
          deadlineClusters[dateStr] = []
        }
        deadlineClusters[dateStr].push(item)
      }
    })

    // Find dates with multiple deadlines
    const busyDates = Object.entries(deadlineClusters)
      .filter(([date, items]) => items.length >= 2)
      .sort((a, b) => new Date(a[0]) - new Date(b[0]))

    if (busyDates.length > 0) {
      insights.push({
        type: 'deadline_clusters',
        title: 'Upcoming Deadline Clusters',
        description: `You have multiple assignments due on ${busyDates[0][0]} (${busyDates[0][1].length} items). We recommend starting these earlier to manage workload effectively.`,
        data: busyDates.map(([date, items]) => ({ date, count: items.length }))
      })
    }
  }

  return insights
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

function initializeFocusChart() {
  console.log('Initializing focus chart...')
  const chartElement = document.getElementById('focus-chart')

  if (!chartElement) {
    console.warn('Focus chart container not found')
    return
  }

  // Load focus session data
  const sessions = loadFocusSessions()

  if (sessions && sessions.length > 0) {
    console.log(`Creating chart with ${sessions.length} sessions`)
    updateFocusChart(sessions)
  } else {
    console.log('No session data available, creating placeholder chart')
    createPlaceholderChart(chartElement)
  }
}

// Ensure D3.js is loaded before creating charts
function createFocusChart() {
  // Check if D3.js is already loaded
  if (window.d3) {
    initializeFocusChart()
  } else {
    // D3.js needs to be loaded
    console.log('D3.js not loaded, attempting to load it...')

    // Try to load D3.js dynamically
    const script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js'
    script.async = true
    script.onload = () => {
      console.log('D3.js loaded successfully')
      initializeFocusChart()
    }
    script.onerror = () => {
      console.error('Failed to load D3.js')
      // Show a message in the chart area
      const chartElement = document.getElementById('focus-chart')
      if (chartElement) {
        chartElement.innerHTML = '<div class="chart-error">Chart library could not be loaded</div>'
      }
    }

    document.head.appendChild(script)
  }
}
// Make sure the chart updates when the window is resized
window.addEventListener(
  'resize',
  debounce(() => {
    // Only update if chart is visible (in active section)
    const chartElement = document.getElementById('focus-chart')
    const dashboardSection = document.getElementById('dashboard-section')

    if (chartElement && dashboardSection && dashboardSection.classList.contains('active')) {
      console.log('Window resized, updating chart')
      initializeFocusChart()
    }
  }, 250)
)

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

      // Let's also prefetch coursework for all courses to make sure the API is working
      console.log('Pre-fetching coursework for all courses...')
      for (const course of courses) {
        try {
          console.log(`Pre-fetching coursework for course ${course.id}`)
          const coursework = await classroomService.fetchCourseWork(course.id)
          // Store the coursework with the course object for later use
          course.courseWork = coursework
          console.log(
            `Successfully fetched ${coursework.length} coursework items for ${course.name}`
          )
        } catch (error) {
          console.error(`Error pre-fetching coursework for course ${course.id}:`, error)
          // Don't fail the whole process, just log the error
          course.courseWork = []
          course.courseWorkError = error.message
        }
      }

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

    // Get the course from the existing data if possible
    const courseElement = document.querySelector(`.course-card[data-course-id="${courseId}"]`)
    const courseName = courseElement?.querySelector('.course-name')?.textContent || 'Course Details'

    // Try to get course work data - first check if we have already fetched it
    let courseWork = []
    const courses = classroomService.getCourseData()
    const course = courses?.find((c) => c.id === courseId)

    if (course && course.courseWork) {
      console.log(`Using previously fetched coursework for course ${courseId}`)
      courseWork = course.courseWork
    } else {
      // Fetch course work data if we don't have it cached
      console.log(`Fetching coursework for course ${courseId} on demand`)
      try {
        courseWork = await classroomService.fetchCourseWork(courseId)
        // Cache the result for future use
        if (course) {
          course.courseWork = courseWork
        }
      } catch (fetchError) {
        console.error(`Error fetching course work for ${courseId}:`, fetchError)
        // We'll handle this gracefully below
      }
    }

    // Remove loading indicator
    document.body.removeChild(loadingIndicator)

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

const classroomServiceUpdate = {
  // Add this method to explicitly update a course's coursework
  updateCourseWork(courseId, courseWork) {
    if (this.courseData) {
      const course = this.courseData.find((c) => c.id === courseId)
      if (course) {
        course.courseWork = courseWork
        return true
      }
    }
    return false
  },

  // Ensure generateCurriculum properly retrieves coursework
  async generateCurriculum(courseIds, useSmart = false) {
    if (!courseIds || courseIds.length === 0) {
      alert('Please select at least one course to generate a curriculum.')
      return
    }

    // Show loading...

    try {
      // Collect course details for selected courses
      const selectedCourses = []
      for (const courseId of courseIds) {
        try {
          // Check if we already have coursework for this course
          const existingCourse = this.courseData.find((c) => c.id === courseId)
          let courseWork = []

          if (existingCourse && existingCourse.courseWork) {
            // Use cached coursework
            courseWork = existingCourse.courseWork
            console.log(`Using cached coursework for course ${courseId}`)
          } else {
            // Fetch coursework if not cached
            console.log(`Fetching coursework for course ${courseId}`)
            courseWork = await this.fetchCourseWork(courseId)

            // Update cache
            if (existingCourse) {
              existingCourse.courseWork = courseWork
            }
          }

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
          // Add the course anyway, but with empty courseWork
          const courseElement = document.querySelector(`.course-card[data-course-id="${courseId}"]`)
          const courseName =
            courseElement?.querySelector('.course-name')?.textContent || 'Unknown Course'

          selectedCourses.push({
            id: courseId,
            name: courseName,
            courseWork: [],
            error: error.message
          })
        }
      }

      console.log('Selected courses with courseWork:', selectedCourses)

      // Continue with generating curriculum...
    } catch (error) {
      console.error('Error generating curriculum:', error)
      alert(`Failed to generate curriculum: ${error.message}`)
    }
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

  setTimeout(() => {
    createFocusChart()
  }, 100)
})

// Export services for use in other modules
export { authService, classroomService, handleRedirectResult }
