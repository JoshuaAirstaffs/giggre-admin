const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');

admin.initializeApp();

exports.onVerificationChange = onDocumentUpdated('users/{userId}', async (event) => {
  const before = event.data.before.data();
  const after  = event.data.after.data();

  // ── Guard: only proceed if isVerified actually changed ──
  if (before.isVerified === after.isVerified) return null;

  // ── Guard: only proceed if this user was referred by someone ──
  const referrerId = after.referredBy;
  if (!referrerId) return null;

  const userId      = event.params.userId;
  const referrerRef = admin.firestore().collection('users').doc(referrerId);
  const referralDoc = referrerRef.collection('referrals_list').doc(userId);

  const counterKey = (status) => {
    switch (status) {
      case 'unverified' : return 'referrals.not_verified_referrals';
      case 'pending'    : return 'referrals.pending_referrals';
      case 'verified'   : return 'referrals.verified_referrals';
      case 'cancelled'  : return 'referrals.cancelled_referrals';
      case 'rejected'   : return 'referrals.rejected_referrals';
      default           : return null;
    }
  };

  const decrementKey = counterKey(before.isVerified);
  const incrementKey = counterKey(after.isVerified);

  const batch = admin.firestore().batch();

  // ── 1. Mirror isVerified on the referrals_list doc ──
  batch.update(referralDoc, { isVerified: after.isVerified });

  // ── 2. Swap the counters on the referrer ──
  const updates = {};
  if (decrementKey) updates[decrementKey] = admin.firestore.FieldValue.increment(-1);
  if (incrementKey) updates[incrementKey] = admin.firestore.FieldValue.increment(1);

  if (Object.keys(updates).length > 0) {
    batch.update(referrerRef, updates);
  }

  await batch.commit();

  console.log(
    `[onVerificationChange] User ${userId}: "${before.isVerified}" → "${after.isVerified}". ` +
    `Referrer ${referrerId} updated.`
  );

  return null;
});