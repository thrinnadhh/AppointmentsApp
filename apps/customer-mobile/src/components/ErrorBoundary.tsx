import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView } from 'react-native';
import { mobileLogger } from '../services/logger';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: error.message || 'An unexpected error occurred',
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    mobileLogger.forComponent('MobileErrorBoundary').error(
      error.message || 'React Native component crashed',
      error,
      {
        componentStack: errorInfo.componentStack,
      }
    );
  }

  handleReload = (): void => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={styles.container}>
          <View style={styles.card}>
            <View style={styles.iconCircle}>
              <Text style={styles.iconText}>⚠️</Text>
            </View>
            <Text style={styles.badge}>APPLICATION NOTICE</Text>
            <Text style={styles.title}>Something went wrong</Text>
            <Text style={styles.description}>
              We encountered an unexpected issue while rendering this screen. Our engineering team has received an automated diagnostic log.
            </Text>
            <TouchableOpacity
              style={styles.button}
              onPress={this.handleReload}
              activeOpacity={0.8}
            >
              <Text style={styles.buttonText}>Restart Screen</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFF1F2',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  iconText: {
    fontSize: 26,
  },
  badge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#BE123C',
    backgroundColor: '#FFF1F2',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0C1A14',
    marginBottom: 8,
    textAlign: 'center',
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 24,
  },
  button: {
    width: '100%',
    backgroundColor: '#047857',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});
