App({
  onShow() {
    const streak = wx.getStorageSync('streak');
    const today = new Date().toISOString().split('T')[0];
    if (streak && streak.last_date !== today) {
      // 可在此触发全局 streak_reset 事件
    }
  }
}); 