import { MaterialCommunityIcons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import React from 'react';
import {
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { haptics } from './haptics';
import { stateLabel, timeAgo } from './format';
import { colors } from './theme';
import type { Vehicle, VehicleState } from './types';
import { GlassSurface, SpringPressable } from './ui';

type Props = {
  vehicle: Vehicle | null;
  favourite: boolean;
  onClose: () => void;
  onOpen: (vehicle: Vehicle) => void;
  onToggleFavourite: (vehicle: Vehicle) => void;
};

/** Long-press preview modelled after the iOS context-menu lift, with Android fallback. */
export function VehicleContextPreview({ vehicle, favourite, onClose, onOpen, onToggleFavourite }: Props) {
  if (!vehicle) return null;
  const tone = toneFor(vehicle.state);
  const share = async () => {
    await haptics.light();
    await Share.share({
      message: `${vehicle.device.name} · ${stateLabel(vehicle.state)} · ${vehicle.speedKmh} km/h · ${vehicle.position?.address || 'Location available in Carva Pulse'}`,
    });
  };
  const open = () => {
    haptics.selection();
    onClose();
    onOpen(vehicle);
  };
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <BlurView tint="dark" intensity={46} style={StyleSheet.absoluteFill} />
        <Pressable accessibilityLabel="Close vehicle preview" style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.content}>
          <GlassSurface style={styles.preview} intensity={52}>
            <View style={styles.liftLine} />
            <View style={styles.heading}>
              <View style={[styles.vehicleIcon, { backgroundColor: `${tone}20`, borderColor: `${tone}66` }]}>
                <MaterialCommunityIcons name="car-sports" size={27} color={tone} />
              </View>
              <View style={styles.headingCopy}>
                <Text style={styles.name} numberOfLines={1}>{vehicle.device.name}</Text>
                <View style={styles.statusLine}>
                  <View style={[styles.dot, { backgroundColor: tone }]} />
                  <Text style={[styles.status, { color: tone }]}>{stateLabel(vehicle.state)}</Text>
                  <Text style={styles.age}>· {timeAgo(vehicle.position?.fixTime || vehicle.device.lastUpdate)}</Text>
                </View>
              </View>
              <Text style={[styles.speed, { color: tone }]}>{vehicle.speedKmh}<Text style={styles.speedUnit}> km/h</Text></Text>
            </View>
            <Text style={styles.address} numberOfLines={2}>{vehicle.position?.address || vehicle.device.uniqueId}</Text>
            <SpringPressable accessibilityRole="button" accessibilityLabel={`Open ${vehicle.device.name}`} onPress={open} style={styles.openAction}>
              <Text style={styles.openText}>Open live view</Text><MaterialCommunityIcons name="arrow-top-right" size={19} color={colors.ink} />
            </SpringPressable>
          </GlassSurface>
          <GlassSurface style={styles.actions} intensity={48}>
            <PreviewAction icon={favourite ? 'star' : 'star-outline'} label={favourite ? 'Saved' : 'Save'} onPress={() => { haptics.selection(); onToggleFavourite(vehicle); }} />
            <PreviewAction icon="share-variant-outline" label="Share" onPress={share} />
            <PreviewAction icon="close" label="Close" onPress={onClose} />
          </GlassSurface>
        </View>
      </View>
    </Modal>
  );
}

function PreviewAction({ icon, label, onPress }: { icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; label: string; onPress: () => void }) {
  return <SpringPressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.previewAction}><MaterialCommunityIcons name={icon} size={21} color={colors.text} /><Text style={styles.actionLabel}>{label}</Text></SpringPressable>;
}

function toneFor(state: VehicleState) { return ({ moving: colors.lime, idling: colors.amber, stopped: colors.cyan, offline: colors.coral, unknown: colors.purple })[state]; }

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', padding: 25, backgroundColor: 'rgba(1, 7, 16, .24)' },
  content: { gap: 11 },
  preview: { borderRadius: 27, padding: 18 },
  liftLine: { alignSelf: 'center', width: 34, height: 4, borderRadius: 4, backgroundColor: colors.lineStrong, marginBottom: 17 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  vehicleIcon: { width: 52, height: 52, borderRadius: 18, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  headingCopy: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontSize: 18, fontWeight: '800' },
  statusLine: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  dot: { width: 6, height: 6, borderRadius: 4, marginRight: 5 },
  status: { fontSize: 11, fontWeight: '800' },
  age: { color: colors.muted, fontSize: 11 },
  speed: { fontSize: 22, fontWeight: '900' },
  speedUnit: { fontSize: 10, color: colors.muted, fontWeight: '700' },
  address: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 15 },
  openAction: { height: 47, borderRadius: 14, marginTop: 19, backgroundColor: colors.lime, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  openText: { color: colors.ink, fontSize: 13, fontWeight: '900' },
  actions: { borderRadius: 19, overflow: 'hidden', flexDirection: 'row' },
  previewAction: { flex: 1, minHeight: 67, alignItems: 'center', justifyContent: 'center', gap: 5, borderRightWidth: 1, borderColor: colors.line },
  actionLabel: { color: colors.text, fontSize: 10, fontWeight: '700' },
});
