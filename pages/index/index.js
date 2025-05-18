Page({
  data: {
    emojis: [
      { emoji: '🔥', text: '活力', type: 'fire', currentScale: 1 },
      { emoji: '😑', text: '疲倦', type: 'tired', currentScale: 1 },
      { emoji: '⚡', text: '能量', type: 'energy', currentScale: 1 },
      { emoji: '😩', text: '超载', type: 'overwhelmed', currentScale: 1 },
      { emoji: '😕', text: '迷茫', type: 'unfocused', currentScale: 1 },
      { emoji: '😌', text: '平静', type: 'calm', currentScale: 1 },
      { emoji: '🧘', text: '专注', type: 'mindful', currentScale: 1 },
      { emoji: '😬', text: '焦虑', type: 'anxious', currentScale: 1 }
    ],
    strategy: {
      '🔥': '/pages/training/training?type=fire',
      '😑': '/pages/training/training?type=tired',
      '⚡': '/pages/training/training?type=energy',
      '😩': '/pages/training/training?type=overwhelmed',
      '😕': '/pages/training/training?type=unfocused',
      '😌': '/pages/training/training?type=calm',
      '🧘': '/pages/training/training?type=mindful',
      '😬': '/pages/training/training?type=anxious'
    },
    historyList: [],
    isLoadingHistory: true,
    showEmptyHistory: false,
    showDonationModal: false,
    historyChartData: [],

    // New data for dock effect
    scrollViewWidth: 0,
    emojiItemWidth: 0, // Includes padding/margin for one item slot
    emojiOffsets: [], // Stores the left offset of each emoji item
    activeEmojiIndex: -1, // Index of the emoji to be magnified
    maxScale: 1.5, // Max scale for the active emoji
    minScale: 1.0, // Min scale for inactive emojis
    scaleRangeFactor: 2, // How many items to the side get scaled (e.g., 1 means active + 1 left + 1 right)
  
    // For gradient hints
    scrollWidth: 0, // Total scrollable width of content
    showLeftGradient: false,
    showRightGradient: false,
    scrollLeftValue: 0, // For setting initial scroll position
    
    // For throttling scroll events
    _throttleTimer: null,
    _lastScrollLeft: 0,
    showBilibiliSection: true,
  },

  // Utility function for throttling
  _throttle(func, delay) {
    let timeoutId = null;
    let lastArgs = null;
    let lastThis = null;

    return function(...args) {
      lastArgs = args;
      lastThis = this;
      if (timeoutId === null) {
        timeoutId = setTimeout(() => {
          func.apply(lastThis, lastArgs);
          timeoutId = null; // Clear timeoutId after execution
        }, delay);
      }
    };
  },

  onLoad() { // Renamed onReady to onLoad to potentially initialize data before first render
    // Initialize emojis with scale and unique id for query
    const initialEmojis = this.data.emojis.map((emoji, index) => ({
      ...emoji,
      id: `emoji-${index}`, // Unique ID for selector
      currentScale: 1,
      left: 0 // Placeholder for offset
    }));
    this.setData({ emojis: initialEmojis });

    // Initialize throttled function
    this.throttledScrollUpdate = this._throttle((scrollLeft) => {
      this.updateEmojiScales(scrollLeft);
      this.updateGradientVisibility(scrollLeft);
    }, 80); // Throttle to roughly every 80ms (adjust as needed)

    const show = wx.getStorageSync('showBilibiliSection');
    this.setData({
      showBilibiliSection: show !== false // 默认true
    });
  },

  onReady() { // Was onShow, changed to onReady for layout-dependent queries
    // this.loadTrainingHistory(); // Moved to onShow
    this.initializeEmojiDock();
  },

  onShow() {
    this.loadTrainingHistory(); // Load history every time the page is shown
    // If initializeEmojiDock needs to be re-run or its state updated onShow, consider logic here.
    // For now, assuming dock initializes correctly onReady and scales are dynamically updated via scroll.
    // If the dock needs to be re-centered or items re-evaluated for some reason onShow:
    // this.initializeEmojiDock(); // This might be too heavy if not needed every time.
    // Or, more selectively, update scales based on current scrollLeft if it might have changed
    // without a scroll event firing while page was hidden (less common for scrollLeft).
    // For instance, if initialScrollLeft was dependent on something that could change:
    if (this.data.scrollLeftValue !== undefined && this.data.emojiOffsets.length > 0) {
        this.throttledScrollUpdate(this.data.scrollLeftValue);
    }
  },

  initializeEmojiDock() {
    const query = wx.createSelectorQuery().in(this);
    query.select('.emoji-scroll-view').boundingClientRect();
    query.selectAll('.emoji-btn-wrapper').fields({ rect: true, size: true, dataset: true }); // Simpler query for offsets initially
    query.select('.emoji-row-inner').scrollOffset(); 
    query.select('.emoji-row-inner').boundingClientRect(); 

    query.exec((res) => {
      // res[0]: .emoji-scroll-view boundingClientRect
      // res[1]: .emoji-btn-wrapper array of fields
      // res[2]: .emoji-row-inner scrollOffset
      // res[3]: .emoji-row-inner boundingClientRect (fallback for scrollWidth)
      if (!res[0] || !res[1] || res[1].length === 0 || !res[2]) { 
        console.error('Failed to get scroll view, emoji item dimensions, or scrollWidth.', JSON.stringify(res));
        setTimeout(() => this.initializeEmojiDock(), 200);
        return;
      }
      
      const scrollViewRect = res[0];
      const scrollViewWidth = scrollViewRect.width;
      
      const firstItemRect = res[1][0];
      const emojiItemWidth = firstItemRect.width;
      
      // Calculate offsets relative to the start of the first emoji item itself.
      // This makes the first item's offset 0 within the scrollable content.
      const firstItemPageOffset = res[1][0].left;
      const emojiOffsets = res[1].map(itemRect => itemRect.left - firstItemPageOffset);
      
      let scrollWidth = res[2].scrollWidth; 
      if (!scrollWidth && res[3] && res[3].width) { 
         // Use .emoji-row-inner's width if scrollWidth from scrollOffset is not available
        scrollWidth = res[3].width; 
      }
      // If still no reliable scrollWidth, estimate based on items and their presumed layout (offsets + last item width)
      if (!scrollWidth && emojiOffsets.length > 0) { 
        scrollWidth = emojiOffsets[emojiOffsets.length - 1] + emojiItemWidth;
      }
      if (!scrollWidth) { // Absolute fallback if everything fails
          console.warn("scrollWidth could not be determined, Dock effect might be impaired.");
          scrollWidth = this.data.emojis.length * emojiItemWidth; // Rough estimate
      }

      this.setData({
        scrollViewWidth: scrollViewWidth,
        emojiItemWidth: emojiItemWidth, 
        emojiOffsets: emojiOffsets,
        scrollWidth: scrollWidth, 
      }, () => {
        const W_item = this.data.emojiItemWidth;
        const SV_width = this.data.scrollViewWidth; // Use the updated scrollViewWidth from setData
        const E_offsets = this.data.emojiOffsets;
        const S_width = this.data.scrollWidth; // Use the updated scrollWidth
        const numEmojis = this.data.emojis.length;
        let desiredScrollLeft = 0;

        if (numEmojis > 0 && W_item > 0 && SV_width > 0 && E_offsets.length === numEmojis) {
          const middleIndex = Math.floor(numEmojis / 2);
          const middleEmojiOffset = E_offsets[middleIndex];
          const middleEmojiCenter = middleEmojiOffset + W_item / 2;
          
          desiredScrollLeft = middleEmojiCenter - SV_width / 2;
        } else if (W_item > 0) {
          // Fallback if data is incomplete, try to show first item as half
          desiredScrollLeft = W_item / 2;
        }
        
        // Clamp desiredScrollLeft to valid range
        desiredScrollLeft = Math.max(0, desiredScrollLeft);
        if (S_width > SV_width) { 
            desiredScrollLeft = Math.min(desiredScrollLeft, S_width - SV_width);
        } else {
            // Content is narrower than or equal to scroll view, so no scrolling needed
            desiredScrollLeft = 0; 
        }
        
        console.log('[initializeEmojiDock] Calculated desiredScrollLeft:', desiredScrollLeft, 
                    'SV_width:', SV_width, 'S_width:', S_width, 'W_item:', W_item, 
                    'middleIndex for centering:', Math.floor(numEmojis / 2));

        this.animateScroll(desiredScrollLeft, 800);
      });
    });
  },
  
  animateScroll(targetScrollLeft, duration) {
    const { scrollLeftValue } = this.data;
    const startTime = Date.now();
    const distance = targetScrollLeft - scrollLeftValue;

    if (distance === 0) {
      this.updateEmojiScales(targetScrollLeft); // Ensure final state is set
      this.updateGradientVisibility(targetScrollLeft);
      return;
    }

    const animateStep = () => {
      const now = Date.now();
      let progress = (now - startTime) / duration;
      if (progress > 1) progress = 1;

      const easedProgress = 1 - Math.pow(1 - progress, 3); // Ease-out cubic
      const currentAnimatingScrollLeft = scrollLeftValue + distance * easedProgress;

      this.setData({ scrollLeftValue: currentAnimatingScrollLeft });
      this.updateEmojiScales(currentAnimatingScrollLeft);
      this.updateGradientVisibility(currentAnimatingScrollLeft);

      if (progress < 1) {
        // Use setTimeout for raf-like behavior in小程序逻辑层
        // Need to ensure `this` context is correct if not using arrow function for animateStep
        setTimeout(animateStep, 16); 
      } else {
        // Animation finished, potentially call wiggle here in future
        console.log("Smooth scroll finished to:", currentAnimatingScrollLeft);
      }
    };
    animateStep();
  },

  handleEmojiScroll(e) {
    const scrollLeft = e.detail.scrollLeft;
    // Call the throttled version
    this.throttledScrollUpdate(scrollLeft);
  },

  updateGradientVisibility(scrollLeft) {
    const { scrollWidth, scrollViewWidth } = this.data;
    if (scrollWidth === 0 || scrollViewWidth === 0) return;

    const threshold = 5; // Small threshold to prevent flickering at edges
    const canScrollLeft = scrollLeft > threshold;
    const canScrollRight = scrollLeft < (scrollWidth - scrollViewWidth - threshold);

    if (this.data.showLeftGradient !== canScrollLeft || this.data.showRightGradient !== canScrollRight) {
        this.setData({
            showLeftGradient: canScrollLeft,
            showRightGradient: canScrollRight,
        });
    }
  },

  updateEmojiScales(scrollLeft) {
    if (this.data.scrollViewWidth === 0 || this.data.emojiItemWidth === 0 || this.data.emojiOffsets.length === 0) {
      // Dimensions not ready yet
      return;
    }

    const scrollViewCenter = scrollLeft + this.data.scrollViewWidth / 2;
    const { emojis, emojiItemWidth, emojiOffsets, maxScale, minScale, scaleRangeFactor } = this.data;
    const halfItemWidth = emojiItemWidth / 2;
    const influenceRadius = emojiItemWidth * scaleRangeFactor;

    let scalesChanged = false;
    const updatedEmojis = emojis.map((emoji, index) => {
      const itemOffsetLeft = emojiOffsets[index];
      const itemCenterGlobal = itemOffsetLeft + halfItemWidth;
      const distanceToCenter = Math.abs(itemCenterGlobal - scrollViewCenter);

      let newScale = minScale;
      if (distanceToCenter < influenceRadius) {
        newScale = minScale + (maxScale - minScale) * Math.max(0, 1 - (distanceToCenter / influenceRadius));
      }
      
      // Round to a few decimal places to avoid tiny floating point differences triggering setData
      newScale = Math.round(newScale * 1000) / 1000;

      if (emoji.currentScale !== newScale) {
        scalesChanged = true;
      }
      return { ...emoji, currentScale: newScale };
    });

    if (scalesChanged) {
      this.setData({ emojis: updatedEmojis });
    }
  },

  loadTrainingHistory() {
    this.setData({ isLoadingHistory: true, showEmptyHistory: false });
    try {
      const history = wx.getStorageSync('trainingHistory');
      if (history && Array.isArray(history) && history.length > 0) {
        const formattedHistory = history.map(item => {
          let displayDurationText = '';
          if (item.duration < 60) {
            displayDurationText = item.duration + '秒';
          } else {
            displayDurationText = Math.floor(item.duration / 60) + '分钟';
          }
          return {
            ...item,
            displayDate: this.formatDate(item.date), 
            displayDuration: displayDurationText 
          };
        });
        this.setData({
          historyList: formattedHistory,
          isLoadingHistory: false,
          showEmptyHistory: false
        });

        // --- Prepare data for the chart (last 7 sessions) ---
        const chartSessions = formattedHistory.slice(0, 7).reverse(); // Take last 7, reverse for chronological chart order
        console.log('[ChartDebug] Raw chartSessions:', JSON.stringify(chartSessions)); // DEBUG
        
        if (chartSessions.length > 0) {
            let maxDuration = 0;
            chartSessions.forEach(session => {
                // Ensure session.duration is treated as a number
                const currentDuration = Number(session.duration);
                if (!isNaN(currentDuration) && currentDuration > maxDuration) {
                    maxDuration = currentDuration;
                }
            });
            const effectiveMaxDuration = maxDuration === 0 ? 1 : maxDuration;
            console.log('[ChartDebug] Effective Max Duration:', effectiveMaxDuration); // DEBUG

            const moodColors = {
                '😊': '#4CAF50', 
                '😐': '#2196F3', 
                '😭': '#F44336', 
                '😌': '#FFC107', 
                '🤩': '#9C27B0', 
                '🤯': '#E91E63', 
                '😕': '#795548', 
                '😴': '#607D8B', 
                'default': '#9E9E9E' 
            };

            const processedChartData = chartSessions.map(session => {
                const shortDate = session.displayDate.substring(5, 10); // MM-DD
                const sessionDuration = Number(session.duration);
                let heightPercent = 0;
                if (effectiveMaxDuration > 0 && !isNaN(sessionDuration)) {
                    heightPercent = (sessionDuration / effectiveMaxDuration) * 100;
                }
                return {
                    ...session,
                    shortDate: shortDate,
                    barHeightPercent: heightPercent,
                    moodColor: moodColors[session.mood] || moodColors['default']
                };
            });
            console.log('[ChartDebug] Processed Chart Data:', JSON.stringify(processedChartData)); // DEBUG
            this.setData({ historyChartData: processedChartData });
        } else {
            this.setData({ historyChartData: [] });
        }
        // --- End of chart data preparation ---

      } else {
        this.setData({
          historyList: [],
          historyChartData: [], // Clear chart data too
          isLoadingHistory: false,
          showEmptyHistory: true
        });
      }
    } catch (e) {
      console.error("Failed to load training history:", e);
      this.setData({
        historyList: [],
        historyChartData: [], // Clear chart data on error
        isLoadingHistory: false,
        showEmptyHistory: true
      });
    }
  },

  formatDate(isoString) {
    if (!isoString) return '日期未知';
    try {
      const date = new Date(isoString);
      const year = date.getFullYear();
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const day = date.getDate().toString().padStart(2, '0');
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      return `${year}-${month}-${day} ${hours}:${minutes}`;
    } catch (e) {
      console.error("Error formatting date:", isoString, e);
      return '日期格式错误';
    }
  },

  handleSelect(e) {
    const emoji = e.currentTarget.dataset.emoji;
    const url = this.data.strategy[emoji];
    wx.navigateTo({ url });
  },

  toggleDonationModal() {
    this.setData({ showDonationModal: !this.data.showDonationModal });
  },

  goBilibiliVideo() {
    const avid = '114500439119522'; // 请确认此avid与BV1ZPEFzsEPD对应
    const path = `pages/video/video?avid=${avid}`;
    wx.navigateToMiniProgram({
      appId: 'wx7564fd5313d24844',
      path: path,
      envVersion: 'release',
      success(res) {
        // 跳转成功
      },
      fail(err) {
        wx.showToast({
          title: '跳转失败，请扫码观看',
          icon: 'none'
        });
      }
    });
  },

  handleExportData() {
    try {
      const history = wx.getStorageSync('trainingHistory') || [];
      const jsonStr = JSON.stringify(history, null, 2);
      const fs = wx.getFileSystemManager();
      const filePath = `${wx.env.USER_DATA_PATH}/training_history_export.json`;
      fs.writeFile({
        filePath,
        data: jsonStr,
        encoding: 'utf8',
        success: () => {
          wx.showActionSheet({
            itemList: ['保存到本地', '通过微信分享'],
            success: (res) => {
              if (res.tapIndex === 0) {
                // 保存到本地
                wx.saveFile({
                  tempFilePath: filePath,
                  success: (saveRes) => {
                    wx.showToast({ title: '已保存到本地文件', icon: 'success' });
                  },
                  fail: () => {
                    wx.showToast({ title: '保存失败', icon: 'none' });
                  }
                });
              } else if (res.tapIndex === 1) {
                // 微信分享
                wx.shareFileMessage ? wx.shareFileMessage({
                  filePath,
                  fileName: 'zenflow_training_history_export.json',
                  success: () => {
                    wx.showToast({ title: '已唤起微信分享', icon: 'success' });
                  },
                  fail: () => {
                    wx.showToast({ title: '分享失败', icon: 'none' });
                  }
                }) : wx.showToast({ title: '当前微信版本不支持文件分享', icon: 'none' });
              }
            },
            fail: () => {
              // 用户取消
            }
          });
        },
        fail: () => {
          wx.showToast({ title: '导出失败', icon: 'none' });
        }
      });
    } catch (e) {
      wx.showToast({ title: '导出异常', icon: 'none' });
    }
  },

  closeBilibiliSection() {
    this.setData({ showBilibiliSection: false });
    wx.setStorageSync('showBilibiliSection', false);
  },

  showBilibiliSectionAgain() {
    this.setData({ showBilibiliSection: true }, () => {
      setTimeout(() => {
        const query = wx.createSelectorQuery();
        query.select('.bilibili-video-section').boundingClientRect();
        query.selectViewport().scrollOffset();
        query.exec(function(res) {
          if (res && res[0] && res[1]) {
            const sectionTop = res[0].top + res[1].scrollTop;
            wx.pageScrollTo({
              scrollTop: sectionTop - 30, // 适当留白
              duration: 400
            });
          }
        });
      }, 100); // 等待区域渲染
    });
    wx.setStorageSync('showBilibiliSection', true);
  },
}); 