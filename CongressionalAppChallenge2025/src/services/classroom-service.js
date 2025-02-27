class ClassroomService {
    constructor() {
      this.baseUrl = 'https://classroom.googleapis.com/v1';
      this.courses = null;
    }
  
    // Get the stored auth token
    getToken() {
      return localStorage.getItem('googleClassroomToken');
    }
  
    // Fetch all active courses
    async fetchCourses() {
      const token = this.getToken();
      if (!token) {
        throw new Error('Not authenticated with Google Classroom');
      }
  
      try {
        const response = await fetch(`${this.baseUrl}/courses?courseStates=ACTIVE`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
  
        if (!response.ok) {
          throw new Error(`Failed to fetch courses: ${response.status}`);
        }
  
        const data = await response.json();
        this.courses = data.courses || [];
        return this.courses;
      } catch (error) {
        console.error('Error fetching courses:', error);
        throw error;
      }
    }
  
    // Fetch coursework for a specific course
    async fetchCourseWork(courseId) {
      const token = this.getToken();
      if (!token) {
        throw new Error('Not authenticated with Google Classroom');
      }
  
      try {
        const response = await fetch(`${this.baseUrl}/courses/${courseId}/courseWork`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
  
        if (!response.ok) {
          throw new Error(`Failed to fetch coursework: ${response.status}`);
        }
  
        const data = await response.json();
        return data.courseWork || [];
      } catch (error) {
        console.error('Error fetching coursework:', error);
        throw error;
      }
    }
  
    // Fetch student submissions for an assignment
    async fetchSubmissions(courseId, courseWorkId) {
      const token = this.getToken();
      if (!token) {
        throw new Error('Not authenticated with Google Classroom');
      }
  
      try {
        const response = await fetch(
          `${this.baseUrl}/courses/${courseId}/courseWork/${courseWorkId}/studentSubmissions`, 
          {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          }
        );
  
        if (!response.ok) {
          throw new Error(`Failed to fetch submissions: ${response.status}`);
        }
  
        const data = await response.json();
        return data.studentSubmissions || [];
      } catch (error) {
        console.error('Error fetching submissions:', error);
        throw error;
      }
    }

    async handleTokenError(error) {
        // If we get a 401 Unauthorized error, the token has expired
        if (error.message.includes('401')) {
          // Clear the stored token
          localStorage.removeItem('googleClassroomToken');
          
          // Prompt for re-authentication
          alert('Your Google Classroom session has expired. Please sign in again.');
          
          // Redirect to login or trigger sign-in flow
          // For example:
          await authService.login();
          
          // Retry the operation that failed (this would be called from the specific method)
          return true;
        }
        return false;
      }
  }
  
  export const classroomService = new ClassroomService();