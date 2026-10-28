import * as ExpoHaptics from 'expo-haptics';

// One deliberately small vocabulary keeps tactile feedback meaningful instead
// of buzzing on every tap. Each method is safe to call on iOS and Android.
export const haptics = {
  selection: () => ExpoHaptics.selectionAsync(),
  light: () => ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Light),
  medium: () => ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Medium),
  success: () => ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Success),
  warning: () => ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Warning),
  error: () => ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Error),
};
