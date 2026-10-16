// Imported automatically (dev bundles only) by the Metro integration, so the
// app needs no code changes. A manually placed <ElementSelector> takes over.
import React from 'react';
import { AppRegistry } from 'react-native';
import { ElementSelector } from './ElementSelector';

function ElementSelectorRoot({ children }: { children?: React.ReactNode }) {
  return <ElementSelector>{children}</ElementSelector>;
}

if (typeof __DEV__ !== 'undefined' && __DEV__) {
  AppRegistry.setWrapperComponentProvider(() => ElementSelectorRoot);
}
