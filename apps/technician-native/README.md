# ClueXP Technician Native

React Native + Expo app for the ClueXP field technician workflow on iOS and Android.

## What This App Connects To

By default the app talks to production:

```text
https://intake.cluexp.com/api
```

Override for local or staging builds with:

```bash
EXPO_PUBLIC_CLUEXP_API_BASE_URL=https://your-api-host.example
```

Demo technician login:

```text
jordan@cluexp.example
123456
```

## Local Checks

Run from the repository root:

```bash
npm install
npm run test:api --workspace @cluexp/technician-native
npm run typecheck --workspace @cluexp/technician-native
```

Run Expo checks from this app directory:

```bash
cd apps/technician-native
npx expo-doctor
npx expo prebuild --no-install
```

## Local Device Runs

Android is the practical local path on Windows:

```bash
npm run android --workspace @cluexp/technician-native
```

iOS requires macOS + Xcode:

```bash
npm run ios --workspace @cluexp/technician-native
```

## Internal Builds

The app uses:

```text
iOS bundle id: com.cluexp.technician
Android package: com.cluexp.technician
URL scheme: cluexp-tech
```

EAS profiles are defined in `eas.json`:

```bash
cd apps/technician-native

# Development client for device QA
eas build --profile development --platform android
eas build --profile development --platform ios

# Internal distribution build
eas build --profile preview --platform android
eas build --profile preview --platform ios
```

Production submission is intentionally separate:

```bash
eas build --profile production --platform android
eas build --profile production --platform ios
eas submit --profile production --platform android
eas submit --profile production --platform ios
```

## Required Device Permissions

Verify these on real devices:

- Location while in use.
- Background location permission behavior where supported.
- Notifications.
- SecureStore persistence across app restart.
- SQLCipher-backed outbox initialization.

## Known Launch Gap

Production APNs/FCM send is not yet configured. Until the push provider and credentials are live,
urgent offers rely on foreground polling and the app is fit for internal pilot testing, not broad
field launch.

