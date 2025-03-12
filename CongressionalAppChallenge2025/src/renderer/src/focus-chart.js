// This should be placed directly in renderer.js or imported as a module

function initializeFocusChart() {
  console.log('Initializing focus chart...');
  
  // Load D3.js if not already loaded
  if (!window.d3) {
    console.log('D3.js not found, charts will be initialized when D3 is loaded');
    return;
  }
  
  // Find the chart container in the dashboard
  const chartElement = document.getElementById('focus-chart');
  if (!chartElement) {
    console.warn('Focus chart container not found');
    return;
  }
  
  // Check if we have session data to display
  const sessions = loadFocusSessions();
  if (sessions && sessions.length > 0) {
    updateFocusChart(sessions);
  } else {
    // Create a placeholder chart if no data is available
    createPlaceholderChart(chartElement);
  }
}

// Function to update the focus chart with session data
function updateFocusChart(sessions) {
  const chartElement = document.getElementById('focus-chart');
  if (!chartElement) return;
  
  try {
    // Only use sessions from the last 7 days
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const recentSessions = sessions.filter((session) => new Date(session.startTime) >= oneWeekAgo);
    
    // If no recent sessions, show placeholder chart
    if (recentSessions.length === 0) {
      createPlaceholderChart(chartElement);
      return;
    }
    
    // Group sessions by day
    const sessionsByDay = {};
    const dayLabels = [];
    
    // Initialize the last 7 days
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dayKey = date.toISOString().slice(0, 10);
      const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
      
      sessionsByDay[dayKey] = {
        scores: [],
        day: dayName,
        date: dayKey
      };
      
      dayLabels.push(dayName);
    }
    
    // Add sessions to their respective days
    recentSessions.forEach((session) => {
      const date = new Date(session.startTime);
      const dayKey = date.toISOString().slice(0, 10);
      
      if (sessionsByDay[dayKey]) {
        sessionsByDay[dayKey].scores.push(session.attentionScore);
      }
    });
    
    // Convert to D3 compatible format
    const currentWeekData = [];
    const previousWeekData = [];
    
    Object.keys(sessionsByDay).forEach((day, index) => {
      const scores = sessionsByDay[day].scores;
      const date = new Date(day);
      
      // Current week data
      if (scores.length > 0) {
        const avgScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
        currentWeekData.push({
          date: date,
          value: Math.round(avgScore)
        });
      } else {
        // Add a null value for days with no data to maintain continuity in the chart
        currentWeekData.push({
          date: date,
          value: null
        });
      }
      
      // Previous week data (placeholder - would need actual previous week data)
      // Creating a date for previous week
      const prevWeekDate = new Date(date);
      prevWeekDate.setDate(prevWeekDate.getDate() - 7);
      
      previousWeekData.push({
        date: prevWeekDate,
        value: Math.round(Math.random() * 30 + 60) // Random value between 60-90
      });
    });
    
    // Create D3.js chart
    createD3FocusChart(chartElement, currentWeekData, previousWeekData);
  } catch (error) {
    console.error('Error updating focus chart:', error);
    createPlaceholderChart(chartElement);
  }
}

// Create a D3.js focus chart
function createD3FocusChart(chartElement, currentWeekData, previousWeekData) {
  if (!window.d3) {
    console.error('D3.js not loaded');
    return;
  }
  
  const d3 = window.d3;
  
  // Clear previous content
  chartElement.innerHTML = '';
  
  // Set up dimensions based on container size
  const containerWidth = chartElement.clientWidth || 800;
  const containerHeight = 300;
  const margin = { top: 30, right: 60, bottom: 40, left: 50 };
  const width = containerWidth - margin.left - margin.right;
  const height = containerHeight - margin.top - margin.bottom;
  
  // Create SVG element
  const svg = d3.select(chartElement)
    .append('svg')
    .attr('width', containerWidth)
    .attr('height', containerHeight)
    .attr('viewBox', `0 0 ${containerWidth} ${containerHeight}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');
  
  // Create group element for the chart
  const chart = svg.append('g')
    .attr('transform', `translate(${margin.left}, ${margin.top})`);
  
  // Combine data for scales
  const allData = [...currentWeekData, ...previousWeekData].filter(d => d.value !== null);
  
  // Set up scales
  const xScale = d3.scaleTime()
    .domain(d3.extent(currentWeekData, d => d.date))
    .range([0, width]);
  
  // Use fixed domain for focus score (0-100)
  const yScale = d3.scaleLinear()
    .domain([0, 100])
    .range([height, 0]);
  
  // Set up axes
  const xAxis = d3.axisBottom(xScale)
    .ticks(7)
    .tickFormat(d3.timeFormat('%a')); // Short day name
  
  const yAxis = d3.axisLeft(yScale)
    .ticks(5)
    .tickFormat(d => `${d}%`);
  
  // Add grid lines
  chart.append('g')
    .attr('class', 'grid-lines')
    .selectAll('line')
    .data(yScale.ticks(5))
    .enter()
    .append('line')
    .attr('x1', 0)
    .attr('x2', width)
    .attr('y1', d => yScale(d))
    .attr('y2', d => yScale(d))
    .attr('stroke', 'rgba(255, 255, 255, 0.1)')
    .attr('stroke-dasharray', '3,3');
  
  // Add X axis
  chart.append('g')
    .attr('class', 'x-axis')
    .attr('transform', `translate(0, ${height})`)
    .call(xAxis)
    .selectAll('text')
    .style('text-anchor', 'middle')
    .attr('fill', '#b0b7c3')
    .attr('font-size', '12px');
  
  // Add Y axis
  chart.append('g')
    .attr('class', 'y-axis')
    .call(yAxis)
    .selectAll('text')
    .attr('fill', '#b0b7c3')
    .attr('font-size', '12px');
  
  // Create line generator
  const line = d3.line()
    .x(d => xScale(d.date))
    .y(d => d.value !== null ? yScale(d.value) : null)
    .defined(d => d.value !== null) // Skip null values
    .curve(d3.curveMonotoneX); // Smooth curve
  
  // Add previous week line (dashed)
  chart.append('path')
    .datum(previousWeekData)
    .attr('class', 'previous-line')
    .attr('fill', 'none')
    .attr('stroke', '#ff9966')
    .attr('stroke-width', 2)
    .attr('stroke-dasharray', '5,5')
    .attr('d', line);
  
  // Add current week line
  const currentLine = chart.append('path')
    .datum(currentWeekData.filter(d => d.value !== null))
    .attr('class', 'focus-line')
    .attr('fill', 'none')
    .attr('stroke', '#3366ff')
    .attr('stroke-width', 3)
    .attr('d', line);
  
  // Add animation to current line
  const currentLineLength = currentLine.node()?.getTotalLength();
  if (currentLineLength) {
    currentLine
      .attr('stroke-dasharray', `${currentLineLength},${currentLineLength}`)
      .attr('stroke-dashoffset', currentLineLength)
      .transition()
      .duration(1500)
      .attr('stroke-dashoffset', 0);
  }
  
  // Add data points for current week
  chart.selectAll('.data-point')
    .data(currentWeekData.filter(d => d.value !== null))
    .enter()
    .append('circle')
    .attr('class', 'data-point')
    .attr('cx', d => xScale(d.date))
    .attr('cy', d => yScale(d.value))
    .attr('r', 4)
    .attr('fill', '#3366ff')
    .attr('stroke', '#fff')
    .attr('stroke-width', 1)
    .style('opacity', 0)
    .transition()
    .delay((d, i) => i * 150)
    .duration(300)
    .style('opacity', 1);
  
  // Add legend
  const legend = svg.append('g')
    .attr('class', 'chart-legend')
    .attr('transform', `translate(${containerWidth - margin.right - 120}, ${margin.top})`);
  
  // Current week legend item
  const currentLegend = legend.append('g')
    .attr('class', 'legend-item');
  
  currentLegend.append('line')
    .attr('x1', 0)
    .attr('x2', 15)
    .attr('y1', 5)
    .attr('y2', 5)
    .attr('stroke', '#3366ff')
    .attr('stroke-width', 3);
  
  currentLegend.append('text')
    .attr('x', 20)
    .attr('y', 9)
    .attr('fill', '#ffffff')
    .attr('font-size', '12px')
    .text('This Week');
  
  // Previous week legend item
  const previousLegend = legend.append('g')
    .attr('class', 'legend-item')
    .attr('transform', 'translate(0, 20)');
  
  previousLegend.append('line')
    .attr('x1', 0)
    .attr('x2', 15)
    .attr('y1', 5)
    .attr('y2', 5)
    .attr('stroke', '#ff9966')
    .attr('stroke-width', 2)
    .attr('stroke-dasharray', '5,5');
  
  previousLegend.append('text')
    .attr('x', 20)
    .attr('y', 9)
    .attr('fill', '#ffffff')
    .attr('font-size', '12px')
    .text('Last Week');
  
  // Add tooltips for data points
  const tooltip = d3.select(chartElement)
    .append('div')
    .attr('class', 'chart-tooltip')
    .style('position', 'absolute')
    .style('visibility', 'hidden')
    .style('background-color', '#262b3c')
    .style('color', '#fff')
    .style('padding', '8px')
    .style('border-radius', '4px')
    .style('font-size', '12px')
    .style('box-shadow', '0 0 10px rgba(0, 0, 0, 0.2)')
    .style('pointer-events', 'none')
    .style('z-index', '100');
  
  // Add tooltip interaction to data points
  chart.selectAll('.data-point')
    .on('mouseover', function(event, d) {
      // Enlarge the point
      d3.select(this)
        .transition()
        .duration(100)
        .attr('r', 6);
      
      // Show tooltip
      tooltip
        .style('visibility', 'visible')
        .html(`
          <div style="font-weight: bold;">${d.date.toLocaleDateString()}</div>
          <div>Focus Score: ${d.value}%</div>
        `)
        .style('left', `${event.pageX + 10}px`)
        .style('top', `${event.pageY - 10}px`);
    })
    .on('mousemove', function(event) {
      tooltip
        .style('left', `${event.pageX + 10}px`)
        .style('top', `${event.pageY - 10}px`);
    })
    .on('mouseout', function() {
      // Restore point size
      d3.select(this)
        .transition()
        .duration(100)
        .attr('r', 4);
      
      // Hide tooltip
      tooltip.style('visibility', 'hidden');
    });
  
  // Add window resize handler using debounce technique
  const resizeHandler = debounce(() => {
    const newWidth = chartElement.clientWidth;
    if (newWidth !== containerWidth) {
      // Redraw chart on significant size change
      createD3FocusChart(chartElement, currentWeekData, previousWeekData);
    }
  }, 250);
  
  window.addEventListener('resize', resizeHandler);
}

// Create a placeholder chart when no data is available
function createPlaceholderChart(chartElement) {
  if (!window.d3) {
    console.error('D3.js not loaded');
    return;
  }
  
  const d3 = window.d3;
  
  // Clear previous content
  chartElement.innerHTML = '';
  
  // Set up dimensions
  const containerWidth = chartElement.clientWidth || 800;
  const containerHeight = 300;
  const margin = { top: 30, right: 60, bottom: 40, left: 50 };
  const width = containerWidth - margin.left - margin.right;
  const height = containerHeight - margin.top - margin.bottom;
  
  // Create SVG element
  const svg = d3.select(chartElement)
    .append('svg')
    .attr('width', containerWidth)
    .attr('height', containerHeight)
    .attr('viewBox', `0 0 ${containerWidth} ${containerHeight}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');
  
  // Create group element for the chart
  const chart = svg.append('g')
    .attr('transform', `translate(${margin.left}, ${margin.top})`);
  
  // Add background grid
  chart.append('g')
    .attr('class', 'grid-lines')
    .selectAll('line')
    .data(d3.range(0, 6))
    .enter()
    .append('line')
    .attr('x1', 0)
    .attr('x2', width)
    .attr('y1', d => d * height / 5)
    .attr('y2', d => d * height / 5)
    .attr('stroke', 'rgba(255, 255, 255, 0.1)')
    .attr('stroke-dasharray', '3,3');
  
  // Add X axis with weekdays
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  chart.append('g')
    .attr('class', 'x-axis')
    .attr('transform', `translate(0, ${height})`)
    .selectAll('text')
    .data(days)
    .enter()
    .append('text')
    .attr('x', (d, i) => i * width / 6)
    .attr('y', 20)
    .attr('text-anchor', 'middle')
    .attr('fill', '#b0b7c3')
    .attr('font-size', '12px')
    .text(d => d);
  
  // Add Y axis labels
  chart.append('g')
    .attr('class', 'y-axis')
    .selectAll('text')
    .data([0, 25, 50, 75, 100])
    .enter()
    .append('text')
    .attr('x', -10)
    .attr('y', d => height - d * height / 100)
    .attr('text-anchor', 'end')
    .attr('dominant-baseline', 'middle')
    .attr('fill', '#b0b7c3')
    .attr('font-size', '12px')
    .text(d => `${d}%`);
  
  // Generate sample data for placeholder lines
  const generatePlaceholderData = () => {
    const data = [];
    for (let i = 0; i < 7; i++) {
      data.push([i * width / 6, height - (Math.random() * 30 + 40) * height / 100]);
    }
    return data;
  };
  
  const currentData = generatePlaceholderData();
  const previousData = generatePlaceholderData();
  
  // Create line generator
  const line = d3.line()
    .curve(d3.curveMonotoneX);
  
  // Add previous week line (dashed)
  chart.append('path')
    .attr('d', line(previousData))
    .attr('fill', 'none')
    .attr('stroke', '#ff9966')
    .attr('stroke-width', 2)
    .attr('stroke-dasharray', '5,5')
    .attr('opacity', 0.5);
  
  // Add current week line
  chart.append('path')
    .attr('d', line(currentData))
    .attr('fill', 'none')
    .attr('stroke', '#3366ff')
    .attr('stroke-width', 3)
    .attr('opacity', 0.7);
  
  // Add the "No data" message
  chart.append('text')
    .attr('x', width / 2)
    .attr('y', height / 2)
    .attr('text-anchor', 'middle')
    .attr('fill', 'rgba(255, 255, 255, 0.5)')
    .attr('font-size', '16px')
    .text('No focus data available yet');
  
  // Add legend
  const legend = svg.append('g')
    .attr('class', 'chart-legend')
    .attr('transform', `translate(${containerWidth - margin.right - 120}, ${margin.top})`);
  
  // Current week legend item
  const currentLegend = legend.append('g')
    .attr('class', 'legend-item');
  
  currentLegend.append('line')
    .attr('x1', 0)
    .attr('x2', 15)
    .attr('y1', 5)
    .attr('y2', 5)
    .attr('stroke', '#3366ff')
    .attr('stroke-width', 3);
  
  currentLegend.append('text')
    .attr('x', 20)
    .attr('y', 9)
    .attr('fill', '#ffffff')
    .attr('font-size', '12px')
    .text('This Week');
  
  // Previous week legend item
  const previousLegend = legend.append('g')
    .attr('class', 'legend-item')
    .attr('transform', 'translate(0, 20)');
  
  previousLegend.append('line')
    .attr('x1', 0)
    .attr('x2', 15)
    .attr('y1', 5)
    .attr('y2', 5)
    .attr('stroke', '#ff9966')
    .attr('stroke-width', 2)
    .attr('stroke-dasharray', '5,5');
  
  previousLegend.append('text')
    .attr('x', 20)
    .attr('y', 9)
    .attr('fill', '#ffffff')
    .attr('font-size', '12px')
    .text('Last Week');
}

// Utility function for debouncing events
function debounce(func, wait) {
  let timeout;
  return function() {
    const context = this;
    const args = arguments;
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      func.apply(context, args);
    }, wait);
  };
}

export { updateFocusChart, createD3FocusChart, createPlaceholderChart, debounce };