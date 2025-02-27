const theme = {
    palette: {
      primary: {
        main: '#3366ff', // Bright blue from chart
        light: '#5c8cff',
        dark: '#2349cc'
      },
      secondary: {
        main: '#ff9966', // Coral/peach from the chart's second line
        light: '#ffb38a',
        dark: '#e67e4d'
      },
      positive: {
        main: '#4cd964', // Green for positive indicators
        light: '#70e385',
        dark: '#37b44e'
      },
      negative: {
        main: '#ff3b30', // Red for negative indicators
        light: '#ff6459',
        dark: '#d32f25'
      },
      background: {
        default: '#1e2230', // Dark navy background
        paper: '#262b3c', // Slightly lighter navy for cards
        elevated: '#2d3348' // Even lighter for hover states or elevated cards
      },
      text: {
        primary: '#ffffff', // White for primary text
        secondary: '#b0b7c3', // Light gray for secondary text
        disabled: '#6c7283' // Darker gray for disabled text
      },
      action: {
        active: '#3366ff',
        hover: 'rgba(51, 102, 255, 0.08)',
        selected: 'rgba(51, 102, 255, 0.16)',
        disabled: 'rgba(176, 183, 195, 0.3)',
        disabledBackground: 'rgba(176, 183, 195, 0.12)'
      },
      divider: 'rgba(255, 255, 255, 0.12)'
    },
    typography: {
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      h1: {
        fontSize: '2rem',
        fontWeight: 500,
        color: '#ffffff'
      },
      h2: {
        fontSize: '1.75rem',
        fontWeight: 500,
        color: '#ffffff'
      },
      h3: {
        fontSize: '1.5rem',
        fontWeight: 500,
        color: '#ffffff'
      },
      h4: {
        fontSize: '1.25rem',
        fontWeight: 500,
        color: '#ffffff'
      },
      body1: {
        fontSize: '1rem',
        color: '#b0b7c3'
      },
      body2: {
        fontSize: '0.875rem',
        color: '#b0b7c3'
      }
    },
    shape: {
      borderRadius: 8
    },
    shadows: [
      'none',
      '0 2px 4px rgba(0, 0, 0, 0.2)',
      '0 4px 8px rgba(0, 0, 0, 0.2)',
      '0 8px 16px rgba(0, 0, 0, 0.2)',
      '0 12px 24px rgba(0, 0, 0, 0.2)'
    ],
    // For charts and data visualization
    chart: {
      primaryLine: '#3366ff', // Blue line
      secondaryLine: '#ff9966', // Coral/peach line
      gridLines: 'rgba(255, 255, 255, 0.1)',
      tooltip: {
        background: '#2d3348',
        border: 'rgba(255, 255, 255, 0.12)'
      }
    },
    // For status indicators
    status: {
      success: '#4cd964',
      warning: '#ffcc00',
      error: '#ff3b30',
      info: '#3366ff'
    }
  };
  
  export default theme;