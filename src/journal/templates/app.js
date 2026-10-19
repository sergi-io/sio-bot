/* global window, document, console, Chart */
// Trading Journal Application
(function () {
  'use strict';

  // Journal data is embedded in the HTML
  const journalData = window.JOURNAL_DATA;

  // Current displayed month for calendar
  let currentYear = new Date().getFullYear();
  let currentMonth = new Date().getMonth();

  // Current selected period
  let currentPeriod = '7d';

  // Chart instances (for cleanup on period change)
  let radarChartInstance = null;
  let cumPnlChartInstance = null;

  /**
   * Format currency value
   */
  function formatMoney(value) {
    const sign = value >= 0 ? '+' : '';
    return sign + '$' + value.toFixed(2);
  }

  /**
   * Format percentage value
   */
  function formatPercent(value) {
    return value.toFixed(1) + '%';
  }

  /**
   * Get CSS class for value (positive/negative/neutral)
   */
  function getValueClass(value) {
    if (value > 0) return 'positive';
    if (value < 0) return 'negative';
    return 'neutral';
  }

  /**
   * Filter positions by time period (rolling periods)
   */
  function filterPositionsByPeriod(positions, period) {
    if (period === 'all') {
      return positions;
    }

    const now = new Date();
    now.setHours(23, 59, 59, 999); // End of today
    let startDate = new Date(now);

    switch (period) {
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '1y':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        return positions;
    }

    startDate.setHours(0, 0, 0, 0); // Start of that day
    const startTimestamp = startDate.getTime();
    return positions.filter((p) => p.closeTimestamp >= startTimestamp);
  }

  /**
   * Calculate metrics from a list of positions
   */
  function calculateMetrics(positions) {
    if (positions.length === 0) {
      return {
        netPnl: 0,
        totalTrades: 0,
        winCount: 0,
        lossCount: 0,
        winRate: 0,
        profitFactor: 0,
        avgWin: 0,
        avgLoss: 0,
        avgWinLossRatio: 0,
        largestWin: 0,
        largestLoss: 0,
        avgTradePnl: 0,
        avgMae: 0,
      };
    }

    const wins = positions.filter((p) => p.realizedPnl > 0);
    const losses = positions.filter((p) => p.realizedPnl <= 0);

    const netPnl = positions.reduce((sum, p) => sum + p.realizedPnl, 0);
    const totalWins = wins.reduce((sum, p) => sum + p.realizedPnl, 0);
    const totalLosses = Math.abs(losses.reduce((sum, p) => sum + p.realizedPnl, 0));

    const avgWin = wins.length > 0 ? totalWins / wins.length : 0;
    const avgLoss = losses.length > 0 ? totalLosses / losses.length : 0;
    const avgMae = positions.reduce((sum, p) => sum + p.mae, 0) / positions.length;

    return {
      netPnl,
      totalTrades: positions.length,
      winCount: wins.length,
      lossCount: losses.length,
      winRate: (wins.length / positions.length) * 100,
      profitFactor: totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0,
      avgWin,
      avgLoss,
      avgWinLossRatio: avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0,
      largestWin: wins.length > 0 ? Math.max(...wins.map((p) => p.realizedPnl)) : 0,
      largestLoss: losses.length > 0 ? Math.min(...losses.map((p) => p.realizedPnl)) : 0,
      avgTradePnl: netPnl / positions.length,
      avgMae,
    };
  }

  /**
   * Group positions by day and calculate cumulative P&L
   */
  function calculateCumulativePnl(positions) {
    if (positions.length === 0) {
      return [];
    }

    // Group by date
    const dailyPnl = {};
    for (const position of positions) {
      const date = new Date(position.closeTimestamp).toISOString().split('T')[0];
      if (!dailyPnl[date]) {
        dailyPnl[date] = 0;
      }
      dailyPnl[date] += position.realizedPnl;
    }

    // Sort dates and calculate cumulative
    const sortedDates = Object.keys(dailyPnl).sort();
    const result = [];
    let cumulative = 0;

    for (const date of sortedDates) {
      cumulative += dailyPnl[date];
      result.push({ date, pnl: cumulative });
    }

    return result;
  }

  /**
   * Render metric cards with filtered data
   */
  function renderMetrics(metrics) {
    document.getElementById('net-pnl').textContent = formatMoney(metrics.netPnl);
    document.getElementById('net-pnl').className = 'value ' + getValueClass(metrics.netPnl);

    document.getElementById('profit-factor').textContent =
      metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2);
    document.getElementById('profit-factor').className =
      'value ' + getValueClass(metrics.profitFactor - 1);

    document.getElementById('win-rate').textContent = formatPercent(metrics.winRate);
    document.getElementById('win-rate').className = 'value ' + getValueClass(metrics.winRate - 50);

    document.getElementById('total-trades').textContent = metrics.totalTrades;
    document.getElementById('total-trades').className = 'value neutral';
  }

  /**
   * Render radar chart for performance overview
   */
  function renderRadarChart(metrics) {
    const ctx = document.getElementById('radar-chart').getContext('2d');

    // Destroy existing chart if exists
    if (radarChartInstance) {
      radarChartInstance.destroy();
    }

    // Normalize values for radar chart (0-100 scale)
    const winRateNorm = Math.min(metrics.winRate, 100);
    const avgRatioNorm = Math.min(metrics.avgWinLossRatio * 25, 100); // 4:1 ratio = 100%
    const profitFactorNorm = Math.min(metrics.profitFactor * 25, 100); // 4 = 100%

    radarChartInstance = new Chart(ctx, {
      type: 'radar',
      data: {
        labels: ['Win Rate', 'Avg W/L Ratio', 'Profit Factor'],
        datasets: [
          {
            label: 'Performance',
            data: [winRateNorm, avgRatioNorm, profitFactorNorm],
            backgroundColor: 'rgba(63, 185, 80, 0.2)',
            borderColor: 'rgba(63, 185, 80, 1)',
            pointBackgroundColor: 'rgba(63, 185, 80, 1)',
            pointBorderColor: '#fff',
            pointHoverBackgroundColor: '#fff',
            pointHoverBorderColor: 'rgba(63, 185, 80, 1)',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          r: {
            beginAtZero: true,
            max: 100,
            ticks: {
              stepSize: 25,
              color: '#8b949e',
            },
            grid: {
              color: '#30363d',
            },
            angleLines: {
              color: '#30363d',
            },
            pointLabels: {
              color: '#e6edf3',
              font: {
                size: 12,
              },
            },
          },
        },
        plugins: {
          legend: {
            display: false,
          },
        },
      },
    });
  }

  /**
   * Render cumulative P&L line chart
   */
  function renderCumPnlChart(cumulativePnl) {
    const ctx = document.getElementById('cum-pnl-chart').getContext('2d');

    // Destroy existing chart if exists
    if (cumPnlChartInstance) {
      cumPnlChartInstance.destroy();
    }

    if (cumulativePnl.length === 0) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.fillStyle = '#8b949e';
      ctx.textAlign = 'center';
      ctx.font = '14px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText('No data for this period', ctx.canvas.width / 2, ctx.canvas.height / 2);
      return;
    }

    const labels = cumulativePnl.map((d) => d.date);
    const data = cumulativePnl.map((d) => d.pnl);

    // Determine line color based on final P&L
    const finalPnl = data[data.length - 1] || 0;
    const lineColor = finalPnl >= 0 ? '#3fb950' : '#f85149';
    const bgColor = finalPnl >= 0 ? 'rgba(63, 185, 80, 0.1)' : 'rgba(248, 81, 73, 0.1)';

    cumPnlChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Cumulative P&L',
            data: data,
            borderColor: lineColor,
            backgroundColor: bgColor,
            fill: true,
            tension: 0.1,
            pointRadius: 3,
            pointHoverRadius: 5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: {
              color: '#8b949e',
              maxRotation: 45,
              minRotation: 45,
            },
            grid: {
              color: '#30363d',
            },
          },
          y: {
            ticks: {
              color: '#8b949e',
              callback: function (value) {
                return '$' + value.toFixed(0);
              },
            },
            grid: {
              color: '#30363d',
            },
          },
        },
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            callbacks: {
              label: function (context) {
                return formatMoney(context.parsed.y);
              },
            },
          },
        },
      },
    });
  }

  /**
   * Render all period-dependent content
   */
  function renderPeriodContent() {
    const filteredPositions = filterPositionsByPeriod(journalData.positions, currentPeriod);
    const metrics = calculateMetrics(filteredPositions);
    const cumulativePnl = calculateCumulativePnl(filteredPositions);

    renderMetrics(metrics);
    renderRadarChart(metrics);
    renderCumPnlChart(cumulativePnl);
  }

  /**
   * Handle period tab click
   */
  function handlePeriodChange(event) {
    const tab = event.target;
    if (!tab.classList.contains('period-tab')) return;

    const period = tab.dataset.period;
    if (period === currentPeriod) return;

    // Update active tab
    document.querySelectorAll('.period-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');

    // Update period and re-render
    currentPeriod = period;
    renderPeriodContent();
  }

  /**
   * Render calendar grid for the current month
   */
  function renderCalendar() {
    const { dailyStats } = journalData;
    const calendarGrid = document.getElementById('calendar-grid');
    const monthLabel = document.getElementById('month-label');

    // Update month label
    const monthNames = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];
    monthLabel.textContent = monthNames[currentMonth] + ' ' + currentYear;

    // Clear existing calendar
    calendarGrid.innerHTML = '';

    // Add day headers
    const dayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    dayHeaders.forEach((day) => {
      const header = document.createElement('div');
      header.className = 'calendar-day-header';
      header.textContent = day;
      calendarGrid.appendChild(header);
    });

    // Get first day of month and total days
    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const today = new Date();

    // Add empty cells for days before first of month
    for (let i = 0; i < firstDay; i++) {
      const emptyCell = document.createElement('div');
      emptyCell.className = 'calendar-day empty';
      calendarGrid.appendChild(emptyCell);
    }

    // Add day cells
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayData = dailyStats[dateStr];

      const dayCell = document.createElement('div');
      dayCell.className = 'calendar-day';

      // Check if today
      if (
        today.getFullYear() === currentYear &&
        today.getMonth() === currentMonth &&
        today.getDate() === day
      ) {
        dayCell.classList.add('today');
      }

      // Add day number
      const dayNumber = document.createElement('div');
      dayNumber.className = 'day-number';
      dayNumber.textContent = day;
      dayCell.appendChild(dayNumber);

      // Add trade data if available
      if (dayData) {
        dayCell.classList.add('has-trades');
        dayCell.classList.add(dayData.totalPnl >= 0 ? 'profit' : 'loss');

        const dayPnl = document.createElement('div');
        dayPnl.className = 'day-pnl';
        dayPnl.textContent = formatMoney(dayData.totalPnl);
        dayCell.appendChild(dayPnl);

        const tradeCount = document.createElement('div');
        tradeCount.className = 'trade-count';
        tradeCount.textContent =
          dayData.tradeCount + ' trade' + (dayData.tradeCount > 1 ? 's' : '');
        dayCell.appendChild(tradeCount);

        // Add click handler to show detail
        dayCell.addEventListener('click', function () {
          showDayDetail(dateStr, dayData);
        });
      }

      calendarGrid.appendChild(dayCell);
    }
  }

  /**
   * Show day detail modal
   */
  function showDayDetail(dateStr, dayData) {
    const overlay = document.getElementById('day-detail-overlay');
    const modal = document.getElementById('day-detail');
    const dateLabel = document.getElementById('day-detail-date');
    const tradeList = document.getElementById('day-detail-trades');

    dateLabel.textContent = dateStr;
    tradeList.innerHTML = '';

    dayData.positions.forEach((position) => {
      const item = document.createElement('li');
      item.className = 'trade-item';

      // Left side: trade info container
      const tradeInfo = document.createElement('div');
      tradeInfo.className = 'trade-info';

      const symbolRow = document.createElement('div');
      symbolRow.className = 'symbol';

      const symbolText = document.createElement('span');
      symbolText.textContent = position.symbol + ' (' + position.side.toUpperCase() + ')';
      symbolRow.appendChild(symbolText);

      // Config preview button (gear emoji)
      const configBtn = document.createElement('button');
      configBtn.className = 'config-preview-btn';
      configBtn.textContent = '⚙️';
      configBtn.title = 'View Config';
      configBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        showConfigModal(position.botConfigJson);
      });
      symbolRow.appendChild(configBtn);

      const timings = document.createElement('span');
      timings.className = 'timings';
      timings.textContent =
        new Date(position.openTimestamp).toLocaleTimeString('es-ES', { hour12: false }) +
        ' → ' +
        new Date(position.closeTimestamp).toLocaleTimeString('es-ES', { hour12: false });
      symbolRow.appendChild(timings);

      tradeInfo.appendChild(symbolRow);

      const details = document.createElement('div');
      details.className = 'details';
      details.textContent =
        'Entry: $' +
        position.entryPrice.toFixed(2) +
        ' → Exit: $' +
        position.closePrice.toFixed(2) +
        ' | ' +
        position.leverage +
        'x';
      tradeInfo.appendChild(details);

      const enterStrategy = document.createElement('div');
      enterStrategy.className = 'details';
      enterStrategy.textContent =
        'Opened: ' + position.openedByStrategies + ' · Closed: ' + position.closedByStrategy;
      tradeInfo.appendChild(enterStrategy);

      item.appendChild(tradeInfo);

      // Right side: P&L and metrics
      const rightSide = document.createElement('div');
      rightSide.style.cssText = 'text-align: right;';

      const pnl = document.createElement('div');
      pnl.className = 'pnl';
      pnl.style.color = position.realizedPnl >= 0 ? '#3fb950' : '#f85149';
      pnl.textContent = formatMoney(position.realizedPnl);
      rightSide.appendChild(pnl);

      const maeAndPnl = document.createElement('div');
      maeAndPnl.style.cssText = 'color: #f85149; font-size: 0.8em;';
      maeAndPnl.textContent =
        'MAE: ' + position.mae.toFixed(2) + '% 🔻 MinPNL: ' + formatMoney(position.minPnl);

      rightSide.appendChild(maeAndPnl);

      item.appendChild(rightSide);

      tradeList.appendChild(item);
    });

    overlay.classList.add('active');
    modal.classList.add('active');
  }

  /**
   * Close day detail modal
   */
  function closeDayDetail() {
    document.getElementById('day-detail-overlay').classList.remove('active');
    document.getElementById('day-detail').classList.remove('active');
  }

  /**
   * Show config modal with formatted JSON
   */
  function showConfigModal(configJson) {
    const overlay = document.getElementById('config-modal-overlay');
    const modal = document.getElementById('config-modal');
    const jsonPre = document.getElementById('config-modal-json');

    try {
      const parsed = JSON.parse(configJson);
      jsonPre.textContent = JSON.stringify(parsed, null, 2);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      jsonPre.textContent = configJson;
    }

    overlay.classList.add('active');
    modal.classList.add('active');
  }

  /**
   * Close config modal
   */
  function closeConfigModal() {
    document.getElementById('config-modal-overlay').classList.remove('active');
    document.getElementById('config-modal').classList.remove('active');
  }

  /**
   * Navigate to previous month
   */
  function prevMonth() {
    currentMonth--;
    if (currentMonth < 0) {
      currentMonth = 11;
      currentYear--;
    }
    renderCalendar();
  }

  /**
   * Navigate to next month
   */
  function nextMonth() {
    currentMonth++;
    if (currentMonth > 11) {
      currentMonth = 0;
      currentYear++;
    }
    renderCalendar();
  }

  /**
   * Setup event listeners
   */
  function setupNavigation() {
    document.getElementById('prev-month').addEventListener('click', prevMonth);
    document.getElementById('next-month').addEventListener('click', nextMonth);
    document.getElementById('close-detail').addEventListener('click', closeDayDetail);
    document.getElementById('day-detail-overlay').addEventListener('click', closeDayDetail);
    document.getElementById('close-config-modal').addEventListener('click', closeConfigModal);
    document.getElementById('config-modal-overlay').addEventListener('click', closeConfigModal);

    // Period tab listeners
    document.querySelector('.period-tabs').addEventListener('click', handlePeriodChange);
  }

  /**
   * Initialize the application
   */
  function init() {
    if (!journalData) {
      console.error('Journal data not found');
      return;
    }

    // Find the most recent trading date to set initial calendar view
    const dates = Object.keys(journalData.dailyStats).sort();
    if (dates.length > 0) {
      const lastDate = new Date(dates[dates.length - 1]);
      currentYear = lastDate.getFullYear();
      currentMonth = lastDate.getMonth();
    }

    // Render period-dependent content (metrics + charts)
    renderPeriodContent();

    // Render calendar (independent of period)
    renderCalendar();

    // Setup navigation
    setupNavigation();

    // Update generation timestamp
    document.getElementById('generated-at').textContent =
      'Generated: ' + new Date(journalData.generatedAt).toLocaleString();
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
