class ClassroomService {
    constructor() {
      this.baseUrl = 'https://classroom.googleapis.com/v1';
      this.courses = null;
    }
  
    // Get the stored auth token
    getToken() {
      return localStorage.getItem('googleClassroomToken');
    }

    async testToken() {
        const token = this.getToken();
        if (!token) {
          throw new Error('No authentication token available');
        }
        
        try {
          // Make a simple API call to verify the token works
          const response = await fetch(`${this.baseUrl}/courses?pageSize=1`, {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });
          
          if (!response.ok) {
            const errorText = await response.text();
            console.error('Token test failed:', errorText);
            
            if (response.status === 401) {
              // Token expired or invalid
              localStorage.removeItem('googleClassroomToken');
              throw new Error('Authentication token expired. Please sign in again.');
            }
            
            throw new Error(`API error: ${response.status}`);
          }
          
          console.log('Token test successful');
          return true;
        } catch (error) {
          console.error('Token test error:', error);
          throw error;
        }
      }
  
    // Fetch all active courses
    async fetchCourses() {
        const token = this.getToken();
        if (!token) {
          throw new Error('Not authenticated with Google Classroom');
        }
        
        try {
          console.log('Fetching Google Classroom courses...');
          // Log the token (safely)
          console.log('Token available:', !!token);
          
          const response = await fetch(`${this.baseUrl}/courses?courseStates=ACTIVE`, {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });
          
          console.log('Response status:', response.status);
          
          if (!response.ok) {
            const errorText = await response.text();
            console.error('API error response:', errorText);
            
            if (response.status === 401) {
              localStorage.removeItem('googleClassroomToken');
              throw new Error('Authentication token expired. Please sign in again.');
            }
            
            throw new Error(`Failed to fetch courses: ${response.status}`);
          }
          
          const data = await response.json();
          console.log('Courses response data:', data);
          this.courseData = data.courses || [];
          
          if (!data.courses || data.courses.length === 0) {
            console.log('No courses found in the response');
          } else {
            console.log(`Found ${data.courses.length} courses`);
          }
          
          return this.courseData;
        } catch (error) {
          console.error('Error fetching Google Classroom courses:', error);
          
          // Handle token expired error
          if (error.message.includes('401')) {
            localStorage.removeItem('googleClassroomToken');
            throw new Error('Google Classroom session expired. Please sign in again.');
          }
          
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