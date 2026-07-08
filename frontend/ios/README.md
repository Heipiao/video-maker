# VowFrame iOS MVP

React Native CLI app, not Expo.

## Run

This folder contains the React Native app and the generated native iOS project.

```bash
cd ios
npm install
bundle install
cd ios && bundle exec pod install && cd ..
npm run ios
```

Set the backend URL before running on device:

```bash
export VOWFRAME_API_BASE_URL=http://127.0.0.1:8001
```

For iOS Simulator, `http://127.0.0.1:8001` works when the backend runs on the same Mac.
