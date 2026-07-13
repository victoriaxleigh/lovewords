import { Platform } from 'react-native';
import Purchases from 'react-native-purchases';
import { supabase } from '../supabase/config';

// RevenueCat dashboard setup required before this works (not done yet — see
// SETUP.md): create a RevenueCat project, add the "lovewords_lifetime"
// non-consumable product from App Store Connect, map it to a "lifetime"
// entitlement, then paste the public iOS API key below.
const REVENUECAT_API_KEY_IOS = 'YOUR_REVENUECAT_IOS_API_KEY';
const LIFETIME_ENTITLEMENT_ID = 'lifetime';

let configured = false;

// No-ops on web — IAP only exists in the native app. The web app stays free.
export function configurePurchases(uid: string) {
  if (Platform.OS === 'web' || configured) return;
  Purchases.configure({ apiKey: REVENUECAT_API_KEY_IOS, appUserID: uid });
  configured = true;
}

export async function getHasLifetimeAccess(): Promise<boolean> {
  if (Platform.OS === 'web') return true; // web is free/unlimited, gate never applies
  try {
    const customerInfo = await Purchases.getCustomerInfo();
    return typeof customerInfo.entitlements.active[LIFETIME_ENTITLEMENT_ID] !== 'undefined';
  } catch {
    // If RevenueCat can't be reached, fail open rather than locking someone
    // out of a game they already paid for.
    return true;
  }
}

export async function purchaseLifetime(): Promise<{ success: boolean; error?: string }> {
  try {
    const offerings = await Purchases.getOfferings();
    const pkg = offerings.current?.availablePackages[0];
    if (!pkg) return { success: false, error: 'Purchase is not available right now.' };

    const { customerInfo } = await Purchases.purchasePackage(pkg);
    const hasLifetime = typeof customerInfo.entitlements.active[LIFETIME_ENTITLEMENT_ID] !== 'undefined';
    if (!hasLifetime) return { success: false, error: 'Purchase did not complete.' };

    await mirrorHasPaidToSupabase(customerInfo.originalAppUserId);
    return { success: true };
  } catch (err: any) {
    if (err?.userCancelled) return { success: false };
    return { success: false, error: err?.message ?? 'Purchase failed. Please try again.' };
  }
}

export async function restorePurchases(): Promise<boolean> {
  try {
    const customerInfo = await Purchases.restorePurchases();
    const hasLifetime = typeof customerInfo.entitlements.active[LIFETIME_ENTITLEMENT_ID] !== 'undefined';
    if (hasLifetime) await mirrorHasPaidToSupabase(customerInfo.originalAppUserId);
    return hasLifetime;
  } catch {
    return false;
  }
}

// Mirrors paid status to Supabase for admin visibility/support — RevenueCat
// (on-device entitlement check) stays the actual source of truth.
async function mirrorHasPaidToSupabase(uid: string) {
  try {
    await supabase.from('profiles').update({ has_paid: true }).eq('id', uid);
  } catch {
    // best-effort only — never block the purchase flow on this
  }
}
