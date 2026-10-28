# Carva Pulse mobile

Native Expo app for iOS and Android. It talks to the existing Carva web API at
`https://gps.carvarent.com`, so it uses each operator's current GPS account and
never embeds tracker or administrator credentials.

```bash
npm install
npm run mobile
```

Use Expo Go for device preview, or create development/production builds with EAS.
Set `EXPO_PUBLIC_CARVA_API_URL` in `.env` to point at another Carva deployment.

## iPhone build from Windows

The project is ready for an EAS development build. Sign in to your Expo account
and run this from the repository root:

```bash
npm install --global eas-cli
eas login
cd apps/mobile
eas build --platform ios --profile development
```

On the first build, EAS will ask you to sign in to your Apple Developer account,
register the iPhone, and link the Expo project. Open the resulting install link
on the iPhone, then run `npm run mobile` from the repository root to serve live
updates to the installed development app.

## Product decisions

- **Pulse command center** instead of a desktop dashboard compressed into a phone.
- A map-first home surface, with the selected vehicle always reachable in one tap.
- Five-second live refresh; manual pull-to-refresh is available from the fleet list.
- Relay controls are intentionally a deliberate two-step action to prevent accidental immobilisation.
