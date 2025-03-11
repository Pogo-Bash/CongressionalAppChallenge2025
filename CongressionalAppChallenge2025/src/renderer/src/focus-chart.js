
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
      }
      
      // Previous week data (placeholder - would need actual previous week data)
      // Creating a date for previous week
      const prevWeekDate = new Date(date);
      prevWeekDate.setDate(prevWeekDate.getDate() - 7);
      
      previousWeekData.push({
        date: prevWeekDate,
        value: Math.random() * 30 + 60 // Random value between 60-90
      });
    });
    
    // Create D3.js chart
    createD3FocusChart(chartElement, currentWeekData, previousWeekData);
  } catch (error) {
    console.error('Error updating focus chart:', error);
    createPlaceholderChart(chartElement);
  }
}

/**
 * Create focus chart with D3.js
 * @param {HTMLElement} chartElement - Container element for the chart
 * @param {Array} currentWeekData - Current week's data
 * @param {Array} previousWeekData - Previous week's data
 */
function createD3FocusChart(chartElement, currentWeekData, previousWeekData) {
  // Clear previous content
  chartElement.innerHTML = '';
  
  // Set up dimensions
  const width = chartElement.clientWidth || 800;
  const height = 300;
  const margin = { top: 30, right: 30, bottom: 40, left: 50 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  
  // Create SVG
  const svg = d3.select(chartElement)
    .append('svg')
    .attr('width', '100%')
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');
  
  // Create chart group
  const chart = svg.append('g')
    .attr('transform', `translate(${margin.left}, ${margin.top})`);
  
  // Combine data for scales
  const allData = [...currentWeekData, ...previousWeekData];
  
  // Create scales
  const xScale = d3.scaleTime()
    .domain(d3.extent(allData, d => d.date))
    .range([0, innerWidth]);
    
  const yScale = d3.scaleLinear()
    .domain([0, 100]) // Focus score is always 0-100
    .range([innerHeight, 0]);
  
  // Create axes
  const xAxis = d3.axisBottom(xScale)
    .ticks(7)
    .tickFormat(d3.timeFormat('%a')); // Format as weekday
    
  const yAxis = d3.axisLeft(yScale)
    .ticks(5)
    .tickFormat(d => `${d}%`);
  
  // Add grid lines
  chart.append('g')
    .attr('class', 'grid')
    .call(d3.axisLeft(yScale)
      .ticks(5)
      .tickSize(-innerWidth)
      .tickFormat('')
    )
    .call(g => g.selectAll('.domain').remove())
    .call(g => g.selectAll('line')
      .attr('stroke', 'rgba(255, 255, 255, 0.1)')
      .attr('stroke-dasharray', '3,3')
    );
  
  // Add X axis
  chart.append('g')
    .attr('class', 'x-axis')
    .attr('transform', `translate(0, ${innerHeight})`)
    .call(xAxis)
    .call(g => g.selectAll('line').attr('stroke', '#b0b7c3'))
    .call(g => g.selectAll('path').attr('stroke', '#b0b7c3'))
    .call(g => g.selectAll('text').attr('fill', '#b0b7c3'));
  
  // Add Y axis
  chart.append('g')
    .attr('class', 'y-axis')
    .call(yAxis)
    .call(g => g.selectAll('line').attr('stroke', '#b0b7c3'))
    .call(g => g.selectAll('path').attr('stroke', '#b0b7c3'))
    .call(g => g.selectAll('text').attr('fill', '#b0b7c3'));
  
  // Create line generators
  const line = d3.line()
    .x(d => xScale(d.date))
    .y(d => yScale(d.value))
    .curve(d3.curveMonotoneX); // Smooth curve
  
  // Add clip path to ensure lines don't extend beyond chart area
  chart.append('defs')
    .append('clipPath')
    .attr('id', 'clip')
    .append('rect')
    .attr('width', innerWidth)
    .attr('height', innerHeight);
  
  // Create a group for lines that respects the clip path
  const linesGroup = chart.append('g')
    .attr('clip-path', 'url(#clip)');
  
  // Add previous week line (dashed)
  if (previousWeekData.length >= 2) {
    const previousPath = linesGroup.append('path')
      .datum(previousWeekData)
      .attr('fill', 'none')
      .attr('stroke', '#ff9966')
      .attr('stroke-width', 3)
      .attr('stroke-dasharray', '5,5')
      .attr('d', line);
    
    // Add animation
    const previousPathLength = previousPath.node().getTotalLength();
    previousPath
      .attr('stroke-dasharray', `${previousPathLength},${previousPathLength}`)
      .attr('stroke-dashoffset', previousPathLength)
      .transition()
      .duration(1500)
      .attr('stroke-dashoffset', 0);
    
    // Add data points
    linesGroup.selectAll('.prev-point')
      .data(previousWeekData)
      .enter()
      .append('circle')
      .attr('class', 'prev-point')
      .attr('cx', d => xScale(d.date))
      .attr('cy', d => yScale(d.value))
      .attr('r', 3)
      .attr('fill', '#ff9966')
      .style('opacity', 0)
      .transition()
      .delay((d, i) => i * 200)
      .duration(300)
      .style('opacity', 1);
  }
  
  // Add current week line
  if (currentWeekData.length >= 2) {
    const currentPath = linesGroup.append('path')
      .datum(currentWeekData)
      .attr('fill', 'none')
      .attr('stroke', '#3366ff')
      .attr('stroke-width', 3)
      .attr('d', line);
    
    // Add animation
    const currentPathLength = currentPath.node().getTotalLength();
    currentPath
      .attr('stroke-dasharray', `${currentPathLength},${currentPathLength}`)
      .attr('stroke-dashoffset', currentPathLength)
      .transition()
      .duration(1500)
      .attr('stroke-dashoffset', 0);
    
    // Add data points with tooltip functionality
    const tooltip = d3.select('body').append('div')
      .attr('class', 'focus-tooltip')
      .style('position', 'absolute')
      .style('visibility', 'hidden')
      .style('background-color', '#262b3c')
      .style('color', '#fff')
      .style('padding', '8px')
      .style('border-radius', '4px')
      .style('font-size', '12px')
      .style('box-shadow', '0 0 10px rgba(0, 0, 0, 0.2)')
      .style('pointer-events', 'none')
      .style('z-index', '1000');
    
    linesGroup.selectAll('.current-point')
      .data(currentWeekData)
      .enter()
      .append('circle')
      .attr('class', 'current-point')
      .attr('cx', d => xScale(d.date))
      .attr('cy', d => yScale(d.value))
      .attr('r', 4)
      .attr('fill', '#3366ff')
      .style('opacity', 0)
      .transition()
      .delay((d, i) => i * 200)
      .duration(300)
      .style('opacity', 1)
      .on('end', function() {
        // Add event listeners after animation
        d3.select(this)
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
              `);
          })
          .on('mousemove', function(event) {
            tooltip
              .style('top', (event.pageY - 10) + 'px')
              .style('left', (event.pageX + 10) + 'px');
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
      });
  }
  
  // Add legend
  const legend = svg.append('g')
    .attr('class', 'legend')
    .attr('transform', `translate(${width - 150}, 20)`);
  
  // Current week legend
  legend.append('circle')
    .attr('cx', 0)
    .attr('cy', 0)
    .attr('r', 5)
    .attr('fill', '#3366ff');
    
  legend.append('text')
    .attr('x', 10)
    .attr('y', 4)
    .attr('fill', '#ffffff')
    .style('font-size', '12px')
    .text('This week');
  
  // Previous week legend
  legend.append('circle')
    .attr('cx', 90)
    .attr('cy', 0)
    .attr('r', 5)
    .attr('fill', '#ff9966');
    
  legend.append('text')
    .attr('x', 100)
    .attr('y', 4)
    .attr('fill', '#ffffff')
    .style('font-size', '12px')
    .text('Last week');
    
  // Add window resize handler
  const resizeHandler = debounce(() => {
    // Get new width
    const newWidth = chartElement.clientWidth;
    if (newWidth === width) return; // No change
    
    // Update chart with new dimensions
    updateD3ChartDimensions(chartElement, currentWeekData, previousWeekData);
  }, 250);
  
  window.addEventListener('resize', resizeHandler);
}

/**
 * Update chart dimensions on resize
 */
function updateD3ChartDimensions(chartElement, currentData, previousData) {
  // Remove existing chart
  chartElement.innerHTML = '';
  
  // Recreate with new dimensions
  createD3FocusChart(chartElement, currentData, previousData);
}

/**
 * Create placeholder chart when no data is available
 * @param {HTMLElement} chartElement - Container element for the chart
 */
function createPlaceholderChart(chartElement) {
  // Clear previous content
  chartElement.innerHTML = '';
  
  const width = chartElement.clientWidth || 800;
  const height = 300;
  
  // Create SVG with D3
  const svg = d3.select(chartElement)
    .append('svg')
    .attr('width', '100%')
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`);
  
  // Add grid lines
  for (let i = 1; i <= 5; i++) {
    svg.append('line')
      .attr('x1', 0)
      .attr('y1', i * 50)
      .attr('x2', width)
      .attr('y2', i * 50)
      .attr('stroke', 'rgba(255,255,255,0.1)')
      .attr('stroke-width', 1);
  }
  
  // Add X-axis labels (days of week)
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  days.forEach((day, i) => {
    svg.append('text')
      .attr('x', (i * width / 6) + (width / 12))
      .attr('y', 270)
      .attr('text-anchor', 'middle')
      .attr('fill', '#b0b7c3')
      .attr('font-size', 12)
      .text(day);
  });
  
  // Create sample curves
  const currentPoints = [];
  const previousPoints = [];
  
  // Generate random points
  for (let i = 0; i < 7; i++) {
    currentPoints.push([i * width / 6, 100 + Math.random() * 100]);
    previousPoints.push([i * width / 6, 130 + Math.random() * 70]);
  }
  
  // Create curve generators
  const lineGenerator = d3.line()
    .x(d => d[0])
    .y(d => d[1])
    .curve(d3.curveBasis);
  
  // Add current week line
  svg.append('path')
    .attr('d', lineGenerator(currentPoints))
    .attr('fill', 'none')
    .attr('stroke', '#3366ff')
    .attr('stroke-width', 3);
  
  // Add previous week line
  svg.append('path')
    .attr('d', lineGenerator(previousPoints))
    .attr('fill', 'none')
    .attr('stroke', '#ff9966')
    .attr('stroke-width', 3)
    .attr('stroke-dasharray', '5,5');
  
  // Add legend
  svg.append('circle')
    .attr('cx', width - 150)
    .attr('cy', 20)
    .attr('r', 5)
    .attr('fill', '#3366ff');
    
  svg.append('text')
    .attr('x', width - 140)
    .attr('y', 25)
    .attr('fill', '#ffffff')
    .attr('font-size', 12)
    .text('This week');
    
  svg.append('circle')
    .attr('cx', width - 60)
    .attr('cy', 20)
    .attr('r', 5)
    .attr('fill', '#ff9966');
    
  svg.append('text')
    .attr('x', width - 50)
    .attr('y', 25)
    .attr('fill', '#ffffff')
    .attr('font-size', 12)
    .text('Last week');
}

/**
 * Debounce function to limit frequency of function calls
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

export { updateFocusChart, createD3FocusChart, createPlaceholderChart };