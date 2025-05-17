Page({
  data: {
    streakDays: 0,
    lastDate: '',
    flameArray: []
  },
  onShow() {
    this.updateStreak();
  },
  updateStreak() {
    const today = new Date().toISOString().split('T')[0];
    let storage = wx.getStorageSync('streak') || { streak_days: 0, last_date: '' };
    if (storage.last_date !== today) {
      storage.streak_days += 1;
      storage.last_date = today;
      wx.setStorageSync('streak', storage);
    }
    this.setData({
      streakDays: storage.streak_days,
      lastDate: storage.last_date,
      flameArray: Array(Math.min(storage.streak_days, 5)).fill(0)
    });
  },
  startToday() {
    this.updateStreak();
    wx.navigateTo({ url: '/pages/training/training' });
  }
}); 