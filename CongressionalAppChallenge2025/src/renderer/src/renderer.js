// Import theme manager
import { themeManager } from './theme-manager.js'
import * as tf from '@tensorflow/tfjs'
import {
  updateFocusChart,
  createD3FocusChart,
  createPlaceholderChart,
  debounce
} from './focus-chart.js'

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

if (window.env?.firebaseConfig?.clientId) {
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

// TensorFlow Service
class TensorFlowService {
  constructor() {
    this.model = null
    this.initialized = false
  }

  async initialize() {
    if (this.initialized) return true

    try {
      console.log('Initializing TensorFlow.js...')

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

      // Create model config - Adding the required runtime property
      const modelConfig = {
        runtime: 'tfjs', // Required parameter
        modelType: 'short',
        maxFaces: 1
      }

      // Use MediaPipeFaceDetector
      const modelName = faceDetection.SupportedModels.MediaPipeFaceDetector

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
    } catch (error) {
      console.error('Failed to initialize TensorFlow:', error)
      throw error
    }
  }

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

      // Try to estimate blinking from available data
      let isBlinking = false
      let eyeOpenness = 1.0

      // Check which properties are actually available
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
  }

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

// Singleton instance
const tensorflowService = new TensorFlowService()

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
    const sessions = loadFocusSessions()

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
let isAuthInProgress = false

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

// Add event listeners for login buttons
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('login-button')?.addEventListener('click', () => {
    console.log('Login button clicked')
    showAccountSelectionModal()
  })

  document.getElementById('curriculum-login-button')?.addEventListener('click', () => {
    console.log('Curriculum login button clicked')
    showAccountSelectionModal()
  })

  document.getElementById('logout-button')?.addEventListener('click', async () => {
    try {
      await signOut(auth)
      localStorage.removeItem('googleClassroomToken')
      console.log('Sign out successful')
    } catch (error) {
      console.error('Error signing out', error)
    }
  })
})

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
async function handleRedirectResult() {
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

// Auth Service - centralized auth management
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
      await signOut(auth)
      localStorage.removeItem('googleClassroomToken')
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

  // Fetch all courses from Google Classroom
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

  // Enhanced fetchCourseWork that handles CORS and implements multiple approaches
  async fetchCourseWork(courseId) {
    const token = this.getToken()
    if (!token) {
      throw new Error('Not authenticated with Google Classroom')
    }

    // Helper function for fetch with CORS handling
    const fetchWithCORS = async (url, options = {}) => {
      // Check if we're in Electron and have access to the proxy
      if (window.electron?.ipcRenderer?.proxyRequest) {
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

    // If no content was found through any method, return empty array
    console.log(`No coursework/materials found for course ${courseId}`)
    return []
  },

  // Method to explicitly update a course's coursework in cache
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
  }
}

// Focus Tracker class implementation

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
          <!-- Video container with wrapper for better positioning -->
          <div class="video-wrapper">
            <div class="video-container">
              <video id="focus-video" autoplay muted playsinline></video>
              <canvas id="focus-overlay"></canvas>
              <div class="face-detection-indicator" id="face-indicator">
                <span class="material-icons">face</span>
              </div>
            </div>
          </div>
          
          <div class="focus-stats">
            <div class="focus-score-metrics-container">
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
            
            <div class="focus-instructions">
              <h4>How It Works</h4>
              <p>Our AI-powered focus tracking helps you maintain concentration during study sessions. Look directly at your screen to maximize your focus score.</p>
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
          </div>
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

      // Make sure canvas dimensions match the video container
      const videoContainer = this.videoElement.parentElement
      if (videoContainer) {
        const containerStyle = getComputedStyle(videoContainer)
        const width = parseInt(containerStyle.width)
        const height = parseInt(containerStyle.height)

        // Set canvas dimensions to match container
        this.canvasElement.width = width
        this.canvasElement.height = height
      }
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
      this.domElements.mainContent.style.display = 'grid' // Changed to grid for better layout
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

    // Add window resize listener to adjust canvas size
    window.addEventListener('resize', () => {
      this.setupCanvas()
    })
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

      // Start tracking loop
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

    // Make sure updateStats is called as a method using 'this'
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

      // Using the updated detection function that properly handles errors
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

      // Update stats during tracking
      this.updateStats()
    } catch (error) {
      console.error('Error during focus tracking:', error)
      // Don't throw here, just log the error to avoid breaking the tracking loop
    }
  }

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
}

// Camera Service
const cameraService = {
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

// Helper function to update dashboard with focus data
function updateDashboardWithFocusData(sessions) {
  if (!sessions || sessions.length === 0) return

  // Calculate total study time (in hours)
  const totalStudyTimeHours = sessions.reduce((total, session) => {
    const duration = session.sessionDuration || (session.endTime - session.startTime) / 1000 / 3600
    return total + duration / 3600 // Convert seconds to hours
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

// Function to initialize focus tracking
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
          <span class="checkmark"></span>
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

// Create course card for display in the UI
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

// Create container for generate button
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

// Setup listeners for course selection checkboxes
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

// Update the generate curriculum button based on selected courses
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

    // Add event listener for smart generate button
    document.getElementById('generate-smart-curriculum-btn')?.addEventListener('click', () => {
      generateCurriculum(selectedCourses, true) // Smart AI-based generation
    })
  } else {
    generateButtonContainer.style.display = 'none'
  }
}

// Get selected course IDs
function getSelectedCourses() {
  const selectedCheckboxes = document.querySelectorAll(
    '.course-checkbox:checked:not(#select-all-courses)'
  )
  return Array.from(selectedCheckboxes).map((checkbox) => checkbox.dataset.courseId)
}

// View course details
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

// Generate curriculum based on selected courses
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
    const selectedCourses = await classroomService.fetchCourseWorkForCourses(courseIds)

    // Generate simple curriculum
    showGeneratedCurriculum(selectedCourses)

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

// Display generated curriculum
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

// Generate timeline HTML for curriculum display
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

// Create date object from due date data
function createDateFromDueDate(dueDate) {
  return new Date(dueDate.year, (dueDate.month || 1) - 1, dueDate.day || 1)
}

// Format date for short display
function formatDateShort(date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric'
  }).format(date)
}

// Get icon for work type
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
    case 'ANNOUNCEMENT':
      return 'campaign'
    default:
      return 'assignment'
  }
}

// Format date for display
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

// Initialize navigation
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
}

// Window control buttons
function initWindowControls() {
  console.log('Initializing window controls...')

  // Set up window control buttons
  if (window.electron?.ipcRenderer) {
    document.getElementById('minimize')?.addEventListener('click', () => {
      console.log('Minimize button clicked')
      window.electron.ipcRenderer.send('window-control', 'minimize')
    })

    document.getElementById('maximize')?.addEventListener('click', () => {
      console.log('Maximize button clicked')
      window.electron.ipcRenderer.send('window-control', 'maximize')
    })

    document.getElementById('close')?.addEventListener('click', () => {
      console.log('Close button clicked')
      window.electron.ipcRenderer.send('window-control', 'close')
    })
  } else {
    console.warn('IPC Renderer not available - window controls will not function')
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
      }
    }

    // Update UI
    updateUI(user)

    // Notify auth listeners
    authService.notifyListeners()
  })
}

// Initialize the application
function initApp() {
  console.log('Initializing application...')

  try {
    // Check for redirect result first
    console.log('Checking for auth redirect result')
    handleRedirectResult()
      .then((redirectUser) => {
        if (redirectUser) {
          console.log('User authenticated via redirect')
        }

        // Initialize theme
        themeManager.initialize()

        // Load focus sessions
        loadFocusSessions()

        // Initialize UI elements
        initNavigation()
        initSettings()
        initWindowControls()
        setupCheckboxListeners()

        // Update dashboard with focus session data
        const sessions = loadFocusSessions()
        updateDashboardWithFocusData(sessions)
      })
      .catch((error) => {
        console.error('Error handling redirect:', error)
      })
  } catch (error) {
    console.error('Error during app initialization:', error)
  }
}

// Initialize focus chart
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

function initIonicComponents() {
  // Set up Ionic tab navigation
  const tabButtons = document.querySelectorAll('ion-tab-button')
  tabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      // Get the tab ID from the button
      const tabId = button.getAttribute('tab')

      // Select the corresponding tab
      const tabs = document.querySelector('ion-tabs')
      if (tabs) {
        tabs.select(tabId)
      }

      // Update selected state on buttons
      tabButtons.forEach((btn) => {
        if (btn === button) {
          btn.setAttribute('selected', true)
        } else {
          btn.removeAttribute('selected')
        }
      })
    })
  })
}

// Call initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded, initializing application...')

  // Initialize Ionic components
  initIonicComponents()

  // Initialize the application
  initApp()

  // Create focus chart with a slight delay to ensure DOM is ready
  setTimeout(() => {
    initializeFocusChart()
  }, 100)

  // Initialize focus tracking when the focus tab is selected
  const focusTab = document.querySelector('ion-tab-button[tab="focus"]')
  if (focusTab) {
    focusTab.addEventListener('click', () => {
      initializeFocusTracking().catch((error) => {
        console.error('Failed to initialize focus tracking:', error)

        // Use Ionic alert controller instead of standard alert
        const alertController =
          document.querySelector('ion-alert-controller') ||
          document.createElement('ion-alert-controller')

        if (!document.body.contains(alertController)) {
          document.body.appendChild(alertController)
        }

        alertController
          .create({
            header: 'Error',
            message: `Failed to initialize focus tracking: ${error.message}`,
            buttons: ['OK']
          })
          .then((alert) => alert.present())
      })
    })
  }
})
