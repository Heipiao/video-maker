import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';

export function SegmentedPicker({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{id: string; label: string; description?: string}>;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.wrap}>
      {options.map(option => {
        const selected = option.id === value;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="button"
            onPress={() => onChange(option.id)}
            style={[styles.option, selected && styles.selected]}>
            <Text style={[styles.label, selected && styles.selectedLabel]}>{option.label}</Text>
            {option.description ? <Text style={styles.description}>{option.description}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
  },
  option: {
    borderWidth: 1,
    borderColor: '#D7D2C9',
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#FFFFFF',
  },
  selected: {
    borderColor: '#111111',
    backgroundColor: '#F8F2EA',
  },
  label: {
    color: '#1B1B1B',
    fontSize: 15,
    fontWeight: '600',
  },
  selectedLabel: {
    color: '#000000',
  },
  description: {
    color: '#62605A',
    fontSize: 13,
    marginTop: 4,
  },
});
