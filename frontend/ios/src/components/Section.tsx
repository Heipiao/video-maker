import React from 'react';
import {StyleSheet, Text, View} from 'react-native';

export function Section({title, children}: {title: string; children: React.ReactNode}) {
  return (
    <View style={styles.section}>
      <Text style={styles.title}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 12,
    paddingVertical: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#D7D2C9',
  },
  title: {
    color: '#141414',
    fontSize: 18,
    fontWeight: '700',
  },
});
