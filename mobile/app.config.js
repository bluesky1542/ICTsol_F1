const { expo } = require("./app.json");

// GitHub Pagesのサブディレクトリは、公開用ビルドのときだけ設定する。
module.exports = {
  ...expo,
  experiments: {
    ...expo.experiments,
    ...(process.env.EXPO_WEB_BASE_URL ? { baseUrl: process.env.EXPO_WEB_BASE_URL } : {}),
  },
};
