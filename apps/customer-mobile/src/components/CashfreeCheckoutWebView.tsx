import React from 'react';
import {
  Modal,
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Linking,
  Platform,
  Alert,
} from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';

export interface CashfreeCheckoutWebViewProps {
  visible: boolean;
  paymentSessionId: string;
  orderId: string;
  bookingId: string;
  mode?: 'sandbox' | 'production';
  onSuccess: (paymentDetails?: { orderId: string; paymentId?: string }) => void;
  onFailure: (errorMsg: string) => void;
  onClose: () => void;
}

export const UPI_SCHEMES = [
  'upi://',
  'tez://',
  'phonepe://',
  'paytmmp://',
  'bhim://',
  'credpay://',
];

export const CASHFREE_ALLOWED_ORIGINS = new Set([
  'https://sdk.cashfree.com',
  'https://api.cashfree.com',
  'https://sandbox.cashfree.com',
  'https://payments.cashfree.com',
  'https://payments-test.cashfree.com',
]);

export function isAllowedCashfreeUrl(urlStr: string): boolean {
  if (!urlStr || typeof urlStr !== 'string') return false;
  if (urlStr === 'about:blank') return true;
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'https:') return false;
    const origin = parsed.origin.toLowerCase();
    if (CASHFREE_ALLOWED_ORIGINS.has(origin)) return true;
    const hostname = parsed.hostname.toLowerCase();
    return hostname === 'cashfree.com' || hostname.endsWith('.cashfree.com');
  } catch {
    return false;
  }
}

export const CashfreeCheckoutWebView: React.FC<CashfreeCheckoutWebViewProps> = ({
  visible,
  paymentSessionId,
  orderId,
  bookingId,
  mode = 'sandbox',
  onSuccess,
  onFailure,
  onClose,
}) => {
  if (!visible || !paymentSessionId) {
    return null;
  }

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <title>Cashfree Secure Checkout</title>
        <script src="https://sdk.cashfree.com/js/v3/cashfree.js"></script>
        <style>
          * { box-sizing: border-box; }
          body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #ffffff;
            color: #0f172a;
          }
          #loader {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 80vh;
            color: #475569;
            font-size: 14px;
            padding: 20px;
            text-align: center;
          }
          .spinner {
            border: 3px solid #e2e8f0;
            border-top: 3px solid #047857;
            border-radius: 50%;
            width: 38px;
            height: 38px;
            animation: spin 0.8s linear infinite;
            margin-bottom: 14px;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <div id="loader">
          <div class="spinner"></div>
          <div>Initializing Cashfree Secure Gateway...</div>
        </div>
        <script>
          window.addEventListener('load', function() {
            try {
              if (!window.Cashfree) {
                if (window.ReactNativeWebView) {
                  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ERROR', message: 'Cashfree SDK failed to load' }));
                }
                return;
              }
              var cashfree = window.Cashfree({ mode: "${mode}" });
              var loader = document.getElementById('loader');
              if (loader) loader.style.display = 'none';

              cashfree.checkout({
                paymentSessionId: "${paymentSessionId}",
                redirectTarget: "_self"
              }).then(function(result) {
                if (result.error) {
                  if (window.ReactNativeWebView) {
                    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'PAYMENT_ERROR', message: result.error.message || 'Payment failed' }));
                  }
                } else if (result.paymentDetails) {
                  if (window.ReactNativeWebView) {
                    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'PAYMENT_SUCCESS', details: result.paymentDetails }));
                  }
                }
              }).catch(function(err) {
                if (window.ReactNativeWebView) {
                  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ERROR', message: String(err) }));
                }
              });
            } catch (err) {
              if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ERROR', message: err.message || 'Unexpected initialization error' }));
              }
            }
          });
        </script>
      </body>
    </html>
  `;

  const handleShouldStartLoad = (request: { url: string }): boolean => {
    const { url } = request;
    if (!url || typeof url !== 'string') return false;

    // 1. Initial local blank load
    if (url === 'about:blank') return true;

    // 2. Check for UPI and native app schemes (intent:* strictly excluded per SEC-WIN-002)
    const isUpiScheme = UPI_SCHEMES.some((scheme) => url.toLowerCase().startsWith(scheme));
    if (isUpiScheme) {
      Linking.canOpenURL(url)
        .then((supported) => {
          if (supported) {
            return Linking.openURL(url);
          } else {
            console.warn('[CashfreeWebView] Unsupported UPI scheme application:', url);
            // On Android, attempt direct open anyway as canOpenURL may return false without queries declaration
            return Linking.openURL(url);
          }
        })
        .catch((err) => {
          console.error('[CashfreeWebView] Error opening UPI app:', err);
          Alert.alert('UPI App Not Found', 'Could not find a supported UPI app on this device to complete the transaction.');
        });
      return false; // Prevent WebView from trying to navigate to upi:// and crashing
    }

    // 3. Check for return / completion URL
    if (
      url.startsWith('appointments://checkout') ||
      url.includes('/checkout/return') ||
      url.includes('return_url') ||
      url.includes('cashfree.com/pg/orders/success')
    ) {
      onSuccess({ orderId });
      return false;
    }

    // 4. Strict HTTPS Cashfree origin allowlist (SEC-WIN-002)
    if (isAllowedCashfreeUrl(url)) {
      return true;
    }

    // Block all other navigation (foreign domains, intent://, data:, javascript:)
    console.warn('[CashfreeWebView] Blocked unauthorized navigation to:', url);
    return false;
  };

  const handleNavigationStateChange = (navState: WebViewNavigation) => {
    const { url } = navState;
    if (
      url.startsWith('appointments://checkout') ||
      url.includes('/checkout/return') ||
      url.includes('return_url') ||
      url.includes('cashfree.com/pg/orders/success')
    ) {
      onSuccess({ orderId });
    }
  };

  const handleMessage = (event: { nativeEvent: { data: string; url?: string } }) => {
    try {
      // SEC-WIN-003: Inspect nativeEvent.url (origin property is not available on native WebView)
      const currentUrl = event.nativeEvent.url;
      if (currentUrl && !isAllowedCashfreeUrl(currentUrl) && currentUrl !== 'about:blank') {
        console.warn('[CashfreeWebView] Ignored postMessage from untrusted URL:', currentUrl);
        return;
      }

      const data = JSON.parse(event.nativeEvent.data);
      // Treat postMessage as an untrusted trigger to initiate backend verification
      if (data.type === 'PAYMENT_SUCCESS') {
        onSuccess({ orderId });
      } else if (data.type === 'PAYMENT_ERROR') {
        onFailure(data.message || 'Payment failed or was cancelled');
      } else if (data.type === 'ERROR') {
        onFailure(data.message || 'Payment gateway error');
      }
    } catch (e) {
      console.warn('[CashfreeWebView] Error parsing postMessage:', e);
    }
  };

  const handleClosePress = () => {
    Alert.alert(
      'Cancel Payment?',
      'Are you sure you want to cancel payment? Your slot hold will expire in a few minutes if payment is not completed.',
      [
        { text: 'Continue Payment', style: 'cancel' },
        { text: 'Cancel', style: 'destructive', onPress: onClose },
      ]
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClosePress}
    >
      <SafeAreaView style={styles.safeArea}>
        {/* Header Bar */}
        <View style={styles.header}>
          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerTitle}>Cashfree Secure Checkout</Text>
            <Text style={styles.headerSubtitle}>Order: {orderId}</Text>
          </View>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={handleClosePress}
            accessibilityLabel="Close Checkout"
          >
            <Text style={styles.closeButtonText}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* WebView Container */}
        <View style={styles.webViewContainer}>
          <WebView
            originWhitelist={['*']}
            source={{
              html: htmlContent,
              baseUrl: 'https://sdk.cashfree.com',
            }}
            onShouldStartLoadWithRequest={handleShouldStartLoad}
            onNavigationStateChange={handleNavigationStateChange}
            onMessage={handleMessage}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            startInLoadingState={true}
            scalesPageToFit={true}
            renderLoading={() => (
              <View style={styles.loaderOverlay}>
                <ActivityIndicator size="large" color="#047857" />
                <Text style={styles.loaderText}>Loading Payment Gateway...</Text>
              </View>
            )}
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  headerTitleContainer: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#64748b',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginTop: 2,
  },
  closeButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#e2e8f0',
  },
  closeButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
  },
  webViewContainer: {
    flex: 1,
  },
  loaderOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loaderText: {
    marginTop: 12,
    fontSize: 13,
    color: '#64748b',
    fontWeight: '500',
  },
});
