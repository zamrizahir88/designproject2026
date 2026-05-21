// ========================================
// SHARED FUNCTIONS - app.js
// For Jury Exhibition System
// ========================================

import { db } from './firebase-config.js';
import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  limit,
  writeBatch,
  Timestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ========================================
// RUBRIC CONFIGURATION
// ========================================

const RUBRIC = {
  a1: { name: "Prototype Functionality & Execution", weight: 5, maxRaw: 5 },
  a2: { name: "Commercial Viability & Market Potential", weight: 4, maxRaw: 5 },
  a3: { name: "Innovation & Problem Solving", weight: 4, maxRaw: 5 },
  a4: { name: "Pitch & Professional Communication", weight: 4, maxRaw: 5 },
  a5: { name: "Overall Industry Recommendation", weight: 3, maxRaw: 5 }
};

// ========================================
// HELPER: Calculate Total Score from Raw Scores
// Formula: (a1 × 5) + (a2 × 4) + (a3 × 4) + (a4 × 4) + (a5 × 3)
// ========================================

export function calculateTotal(rawScores) {
  if (!rawScores) return 0;
  const total = (rawScores.a1 * 5) + 
                (rawScores.a2 * 4) + 
                (rawScores.a3 * 4) + 
                (rawScores.a4 * 4) + 
                (rawScores.a5 * 3);
  return total; // Max 100, Min 0
}

// ========================================
// HELPER: Format timestamp to readable string
// ========================================

export function formatTimestamp(timestamp) {
  if (!timestamp) return 'Not set';
  const date = timestamp.toDate();
  return date.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' }) + 
         ' ' + date.toLocaleDateString('en-MY');
}

// ========================================
// EVALUATION STATUS FUNCTIONS (NEW)
// ========================================

// Update evaluation status for a jury-group pair
export async function updateEvaluationStatus(juryPin, juryName, groupNumber, status, startedAt = null) {
  try {
    const statusRef = doc(db, 'evaluation_status', `${juryPin}_${groupNumber}`);
    const statusData = {
      juryPin: juryPin,
      juryName: juryName,
      groupNumber: groupNumber,
      status: status, // 'active', 'completed', 'not_started'
      updatedAt: Timestamp.now()
    };
    
    if (startedAt) {
      statusData.startedAt = startedAt;
    } else if (status === 'active') {
      statusData.startedAt = Timestamp.now();
    }
    
    if (status === 'completed') {
      statusData.completedAt = Timestamp.now();
    }
    
    await setDoc(statusRef, statusData, { merge: true });
    return { success: true };
  } catch (error) {
    console.error('Error updating evaluation status:', error);
    return { success: false, error: error.message };
  }
}

// Get evaluation status for a specific jury-group
export async function getEvaluationStatus(juryPin, groupNumber) {
  try {
    const statusRef = doc(db, 'evaluation_status', `${juryPin}_${groupNumber}`);
    const statusDoc = await getDoc(statusRef);
    if (statusDoc.exists()) {
      return statusDoc.data().status;
    }
    return 'not_started';
  } catch (error) {
    console.error('Error getting evaluation status:', error);
    return 'not_started';
  }
}

// Get all evaluation statuses (for admin dashboard)
export async function getAllEvaluationStatuses() {
  try {
    const statusRef = collection(db, 'evaluation_status');
    const statusSnapshot = await getDocs(statusRef);
    const statuses = [];
    statusSnapshot.forEach(doc => {
      statuses.push({ id: doc.id, ...doc.data() });
    });
    return statuses;
  } catch (error) {
    console.error('Error getting evaluation statuses:', error);
    return [];
  }
}

// Get active evaluations (groups being evaluated right now)
export async function getActiveEvaluations() {
  try {
    const statusRef = collection(db, 'evaluation_status');
    const q = query(statusRef, where('status', '==', 'active'));
    const statusSnapshot = await getDocs(q);
    const active = [];
    statusSnapshot.forEach(doc => {
      active.push({ id: doc.id, ...doc.data() });
    });
    return active;
  } catch (error) {
    console.error('Error getting active evaluations:', error);
    return [];
  }
}

// ========================================
// JURY FUNCTIONS
// ========================================

// Validate PIN and get jury data
export async function validateJuryPin(pin) {
  try {
    const juriesRef = collection(db, 'juries');
    const q = query(juriesRef, where('pin', '==', pin));
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
      return { success: false, error: 'Invalid PIN' };
    }
    
    const juryDoc = querySnapshot.docs[0];
    const juryData = juryDoc.data();
    
    return { 
      success: true, 
      juryId: juryDoc.id, 
      juryData: juryData 
    };
  } catch (error) {
    console.error('Error validating PIN:', error);
    return { success: false, error: 'Database error' };
  }
}

// Update jury name (if they entered their name at login)
export async function updateJuryName(juryId, name) {
  try {
    const juryRef = doc(db, 'juries', juryId);
    await updateDoc(juryRef, { name: name });
    return { success: true };
  } catch (error) {
    console.error('Error updating jury name:', error);
    return { success: false, error: 'Failed to update name' };
  }
}

// Jury check-in
export async function juryCheckIn(juryId, juryName) {
  try {
    const juryRef = doc(db, 'juries', juryId);
    await updateDoc(juryRef, {
      checkedIn: true,
      checkInTime: Timestamp.now()
    });
    
    // Add audit log
    await addDoc(collection(db, 'audit_logs'), {
      action: 'JURY_CHECKIN',
      adminName: juryName,
      targetType: 'jury',
      targetId: juryId,
      newValue: true,
      timestamp: Timestamp.now()
    });
    
    return { success: true };
  } catch (error) {
    console.error('Error checking in:', error);
    return { success: false, error: 'Failed to check in' };
  }
}

// Get jury's assigned groups with their scores and evaluation status
export async function getJuryAssignedGroups(juryId, juryData) {
  const assignedGroups = juryData.assignedGroups || [];
  const completedGroups = juryData.completedGroups || [];
  const juryPin = juryData.pin;
  
  const groupsData = [];
  
  for (const groupNum of assignedGroups) {
    // Fetch group details from groups collection
    const groupRef = doc(db, 'groups', groupNum.toString());
    const groupDoc = await getDoc(groupRef);
    const groupDetails = groupDoc.exists() ? groupDoc.data() : {};
    
    // Get evaluation status
    const evalStatus = await getEvaluationStatus(juryPin, groupNum);
    
    // Get existing final score for this jury-group
    const scoresRef = collection(db, 'scores');
    const q = query(
      scoresRef, 
      where('juryPin', '==', juryData.pin),
      where('groupNumber', '==', groupNum),
      where('isFinal', '==', true)
    );
    const scoreSnapshot = await getDocs(q);
    
    let existingScore = null;
    let existingRawScores = null;
    
    if (!scoreSnapshot.empty) {
      const scoreDoc = scoreSnapshot.docs[0];
      existingScore = scoreDoc.data();
      existingRawScores = existingScore.rawScores;
    }
    
    groupsData.push({
      groupNumber: groupNum,
      mainSV: groupDetails.mainSV || 'Not assigned',
      coSV: groupDetails.coSV || 'Not assigned',
      students: groupDetails.students || [],
      studentCount: groupDetails.studentCount || 0,
      isCompleted: completedGroups.includes(groupNum),
      evaluationStatus: evalStatus,
      savedScore: existingScore,
      savedRawScores: existingRawScores
    });
  }
  
  return groupsData;
}

// Start evaluating a group (sets status to active)
export async function startEvaluatingGroup(juryPin, juryName, groupNumber) {
  try {
    // First, check if this jury has any other active evaluation
    const allStatuses = await getAllEvaluationStatuses();
    const juryStatuses = allStatuses.filter(s => s.juryPin === juryPin && s.status === 'active');
    
    // Close any other active evaluations for this jury
    for (const active of juryStatuses) {
      if (active.groupNumber !== groupNumber) {
        await updateEvaluationStatus(juryPin, juryName, active.groupNumber, 'not_started');
      }
    }
    
    // Start the new evaluation
    const result = await updateEvaluationStatus(juryPin, juryName, groupNumber, 'active');
    
    // Add audit log
    await addDoc(collection(db, 'audit_logs'), {
      action: 'START_EVALUATING',
      adminName: juryName,
      targetType: 'group',
      targetId: `group_${groupNumber}`,
      newValue: 'active',
      timestamp: Timestamp.now()
    });
    
    return result;
  } catch (error) {
    console.error('Error starting evaluation:', error);
    return { success: false, error: error.message };
  }
}

// ========================================
// DRAFT FUNCTIONS (localStorage)
// ========================================

// Save draft to localStorage (not Firebase)
export function saveDraftToLocalStorage(juryPin, groupNumber, rawScores, total) {
  const draftKey = `draft_${juryPin}_${groupNumber}`;
  const draftData = {
    rawScores: rawScores,
    total: total,
    timestamp: new Date().toISOString()
  };
  localStorage.setItem(draftKey, JSON.stringify(draftData));
}

// Load draft from localStorage
export function loadDraftFromLocalStorage(juryPin, groupNumber) {
  const draftKey = `draft_${juryPin}_${groupNumber}`;
  const draft = localStorage.getItem(draftKey);
  if (draft) {
    return JSON.parse(draft);
  }
  return null;
}

// Clear draft from localStorage (after final submit)
export function clearDraftFromLocalStorage(juryPin, groupNumber) {
  const draftKey = `draft_${juryPin}_${groupNumber}`;
  localStorage.removeItem(draftKey);
}

// ========================================
// SUBMIT FINAL SCORE
// ========================================

// Submit final score to Firebase
export async function submitFinalScore(juryPin, juryName, groupNumber, rawScores, total) {
  try {
    // Check if judging is still open
    const settingsRef = doc(db, 'settings', 'current');
    const settingsDoc = await getDoc(settingsRef);
    
    if (settingsDoc.exists()) {
      const settings = settingsDoc.data();
      if (!settings.isOpen) {
        return { success: false, error: 'Judging is closed' };
      }
      
      if (settings.judgingEndTime) {
        const now = Timestamp.now();
        if (now.toDate() > settings.judgingEndTime.toDate()) {
          return { success: false, error: 'Judging time has ended' };
        }
      }
    }
    
    // Check if already submitted (prevent duplicate)
    const scoresRef = collection(db, 'scores');
    const q = query(
      scoresRef,
      where('juryPin', '==', juryPin),
      where('groupNumber', '==', groupNumber),
      where('isFinal', '==', true)
    );
    const existing = await getDocs(q);
    
    let scoreRef;
    let isUpdate = false;
    
    if (!existing.empty) {
      // Update existing
      scoreRef = doc(db, 'scores', existing.docs[0].id);
      await updateDoc(scoreRef, {
        rawScores: rawScores,
        total: total,
        lastModified: Timestamp.now()
      });
      isUpdate = true;
    } else {
      // Create new
      await addDoc(collection(db, 'scores'), {
        juryPin: juryPin,
        juryName: juryName,
        groupNumber: groupNumber,
        rawScores: rawScores,
        total: total,
        isFinal: true,
        submittedAt: Timestamp.now(),
        lastModified: Timestamp.now()
      });
    }
    
    // Update jury's completedGroups
    const juriesRef = collection(db, 'juries');
    const juryQuery = query(juriesRef, where('pin', '==', juryPin));
    const jurySnapshot = await getDocs(juryQuery);
    
    if (!jurySnapshot.empty) {
      const juryDoc = jurySnapshot.docs[0];
      const juryData = juryDoc.data();
      const completedGroups = juryData.completedGroups || [];
      
      if (!completedGroups.includes(groupNumber)) {
        completedGroups.push(groupNumber);
        await updateDoc(doc(db, 'juries', juryDoc.id), {
          completedGroups: completedGroups
        });
      }
    }
    
    // Update evaluation status to completed
    await updateEvaluationStatus(juryPin, juryName, groupNumber, 'completed');
    
    // Clear localStorage draft
    clearDraftFromLocalStorage(juryPin, groupNumber);
    
    // Add audit log
    await addDoc(collection(db, 'audit_logs'), {
      action: isUpdate ? 'FINAL_SUBMIT_UPDATE' : 'FINAL_SUBMIT',
      adminName: juryName,
      targetType: 'score',
      targetId: `${juryPin}_group_${groupNumber}`,
      newValue: total,
      timestamp: Timestamp.now()
    });
    
    return { success: true, isUpdate: isUpdate };
    
  } catch (error) {
    console.error('Error submitting score:', error);
    return { success: false, error: 'Failed to submit' };
  }
}

// ========================================
// ADMIN FUNCTIONS
// ========================================

// Get all groups with their final averages and ranks
export async function getAllGroups() {
  try {
    const groupsRef = collection(db, 'groups');
    const groupsSnapshot = await getDocs(groupsRef);
    const groups = [];
    
    groupsSnapshot.forEach(doc => {
      groups.push({ id: doc.id, ...doc.data() });
    });
    
    // Sort by number
    groups.sort((a, b) => a.number - b.number);
    return groups;
  } catch (error) {
    console.error('Error getting groups:', error);
    return [];
  }
}

// Get all scores for calculating averages
export async function getAllScores() {
  try {
    const scoresRef = collection(db, 'scores');
    const q = query(scoresRef, where('isFinal', '==', true));
    const scoresSnapshot = await getDocs(q);
    const scores = [];
    
    scoresSnapshot.forEach(doc => {
      scores.push(doc.data());
    });
    
    return scores;
  } catch (error) {
    console.error('Error getting scores:', error);
    return [];
  }
}

// Calculate group averages and tie-breaking details
export async function calculateGroupAverages() {
  const scores = await getAllScores();
  const groupsMap = new Map();
  
  // Group scores by groupNumber
  scores.forEach(score => {
    const groupNum = score.groupNumber;
    if (!groupsMap.has(groupNum)) {
      groupsMap.set(groupNum, []);
    }
    groupsMap.get(groupNum).push(score);
  });
  
  const groupAverages = [];
  
  for (let [groupNum, groupScores] of groupsMap) {
    let totalSum = 0;
    let a1Sum = 0, a2Sum = 0, a3Sum = 0, a4Sum = 0, a5Sum = 0;
    const count = groupScores.length;
    
    groupScores.forEach(score => {
      totalSum += score.total;
      a1Sum += score.rawScores.a1;
      a2Sum += score.rawScores.a2;
      a3Sum += score.rawScores.a3;
      a4Sum += score.rawScores.a4;
      a5Sum += score.rawScores.a5;
    });
    
    groupAverages.push({
      groupNumber: groupNum,
      finalAverage: totalSum / count,
      a1_avg: a1Sum / count,
      a2_avg: a2Sum / count,
      a3_avg: a3Sum / count,
      a4_avg: a4Sum / count,
      a5_avg: a5Sum / count,
      juryCount: count
    });
  }
  
  // Sort by finalAverage (highest first), then tie-break by A1->A5
  groupAverages.sort((a, b) => {
    if (a.finalAverage !== b.finalAverage) {
      return b.finalAverage - a.finalAverage;
    }
    if (a.a1_avg !== b.a1_avg) return b.a1_avg - a.a1_avg;
    if (a.a2_avg !== b.a2_avg) return b.a2_avg - a.a2_avg;
    if (a.a3_avg !== b.a3_avg) return b.a3_avg - a.a3_avg;
    if (a.a4_avg !== b.a4_avg) return b.a4_avg - a.a4_avg;
    if (a.a5_avg !== b.a5_avg) return b.a5_avg - a.a5_avg;
    return a.groupNumber - b.groupNumber;
  });
  
  // Assign ranks
  let rank = 1;
  for (let i = 0; i < groupAverages.length; i++) {
    if (i > 0 && groupAverages[i].finalAverage === groupAverages[i-1].finalAverage) {
      groupAverages[i].rank = groupAverages[i-1].rank;
    } else {
      groupAverages[i].rank = rank;
    }
    rank++;
  }
  
  return groupAverages;
}

// Update groups collection with calculated averages and ranks
export async function updateGroupRanks() {
  const averages = await calculateGroupAverages();
  const batch = writeBatch(db);
  
  for (const group of averages) {
    const groupRef = doc(db, 'groups', group.groupNumber.toString());
    batch.update(groupRef, {
      finalAverage: group.finalAverage,
      rank: group.rank,
      tieBreakDetails: {
        a1_avg: group.a1_avg,
        a2_avg: group.a2_avg,
        a3_avg: group.a3_avg,
        a4_avg: group.a4_avg,
        a5_avg: group.a5_avg
      },
      juryCount: group.juryCount,
      lastUpdated: Timestamp.now()
    });
  }

  const allGroups = await getAllGroups();
  const updatedGroupNumbers = new Set(averages.map(a => a.groupNumber));
  for (const group of allGroups) {
    if (!updatedGroupNumbers.has(group.number)) {
      const groupRef = doc(db, 'groups', group.number.toString());
      batch.update(groupRef, {
        finalAverage: 0,
        rank: 0,
        juryCount: 0,
        lastUpdated: Timestamp.now()
      });
    }
  }
  
  await batch.commit();
  return averages;
}

// Get all juries (for admin)
export async function getAllJuries() {
  try {
    const juriesRef = collection(db, 'juries');
    const juriesSnapshot = await getDocs(juriesRef);
    const juries = [];
    
    juriesSnapshot.forEach(doc => {
      juries.push({ id: doc.id, ...doc.data() });
    });
    
    return juries;
  } catch (error) {
    console.error('Error getting juries:', error);
    return [];
  }
}

// Assign groups to a jury (admin)
export async function assignGroupsToJury(juryId, assignedGroups) {
  try {
    const juryRef = doc(db, 'juries', juryId);
    await updateDoc(juryRef, {
      assignedGroups: assignedGroups
    });
    
    // Add audit log
    await addDoc(collection(db, 'audit_logs'), {
      action: 'ASSIGN_GROUPS',
      adminName: 'Admin',
      targetType: 'jury',
      targetId: juryId,
      newValue: assignedGroups,
      timestamp: Timestamp.now()
    });
    
    return { success: true };
  } catch (error) {
    console.error('Error assigning groups:', error);
    return { success: false, error: 'Failed to assign' };
  }
}

// Override group score (admin)
export async function overrideGroupScore(groupNumber, newScore, reason, adminName) {
  try {
    const groupRef = doc(db, 'groups', groupNumber.toString());
    const groupDoc = await getDoc(groupRef);
    const oldScore = groupDoc.exists() ? groupDoc.data().finalAverage : 0;
    
    await updateDoc(groupRef, {
      finalAverage: newScore,
      overridden: true,
      overrideReason: reason,
      overriddenBy: adminName,
      overriddenAt: Timestamp.now()
    });
    
    // Add audit log
    await addDoc(collection(db, 'audit_logs'), {
      action: 'OVERRIDE_SCORE',
      adminName: adminName,
      targetType: 'group',
      targetId: `group_${groupNumber}`,
      oldValue: oldScore,
      newValue: newScore,
      reason: reason,
      timestamp: Timestamp.now()
    });
    
    return { success: true };
  } catch (error) {
    console.error('Error overriding score:', error);
    return { success: false, error: 'Failed to override' };
  }
}

// Extend judging time (admin)
export async function extendJudgingTime(newEndTime, adminName) {
  try {
    const settingsRef = doc(db, 'settings', 'current');
    await updateDoc(settingsRef, {
      judgingEndTime: newEndTime,
      lastModifiedBy: adminName,
      lastModifiedAt: Timestamp.now()
    });
    
    await addDoc(collection(db, 'audit_logs'), {
      action: 'EXTEND_TIME',
      adminName: adminName,
      targetType: 'settings',
      newValue: newEndTime.toDate().toString(),
      timestamp: Timestamp.now()
    });
    
    return { success: true };
  } catch (error) {
    console.error('Error extending time:', error);
    return { success: false, error: 'Failed to extend time' };
  }
}

// Reopen or close judging system (admin)
export async function setJudgingOpen(isOpen, adminName) {
  try {
    const settingsRef = doc(db, 'settings', 'current');
    await updateDoc(settingsRef, {
      isOpen: isOpen,
      lastModifiedBy: adminName,
      lastModifiedAt: Timestamp.now()
    });
    
    await addDoc(collection(db, 'audit_logs'), {
      action: isOpen ? 'REOPEN_SYSTEM' : 'CLOSE_SYSTEM',
      adminName: adminName,
      targetType: 'settings',
      newValue: isOpen,
      timestamp: Timestamp.now()
    });
    
    return { success: true };
  } catch (error) {
    console.error('Error changing system state:', error);
    return { success: false, error: 'Failed to change state' };
  }
}

// Export to CSV
export function exportToCSV(groups, scores) {
  const rows = [];
  rows.push(['Rank', 'Group Number', 'Project Title', 'Final Average', 'Jury Count', 'A1 Avg', 'A2 Avg', 'A3 Avg', 'A4 Avg', 'A5 Avg']);
  
  groups.forEach(group => {
    rows.push([
      group.rank,
      group.groupNumber,
      group.projectTitle || '',
      group.finalAverage.toFixed(2),
      group.juryCount || 0,
      group.a1_avg?.toFixed(2) || '0',
      group.a2_avg?.toFixed(2) || '0',
      group.a3_avg?.toFixed(2) || '0',
      group.a4_avg?.toFixed(2) || '0',
      group.a5_avg?.toFixed(2) || '0'
    ]);
  });
  
  const csvContent = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `jury_ranking_${new Date().toISOString().slice(0,19).replace(/:/g, '-')}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ========================================
// DARK MODE TOGGLE
// ========================================

export function initDarkMode() {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
  
  const toggleBtn = document.getElementById('darkModeToggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme');
      if (currentTheme === 'dark') {
        document.documentElement.removeAttribute('data-theme');
        localStorage.setItem('theme', 'light');
      } else {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
      }
    });
  }
}

// ========================================
// ADMIN AUTHENTICATION
// ========================================

const ADMIN_PASSWORD = 'admin123'; // CHANGE THIS BEFORE EVENT!

export function isAdminAuthenticated() {
  return sessionStorage.getItem('adminAuth') === 'true';
}

export function authenticateAdmin(password) {
  if (password === ADMIN_PASSWORD) {
    sessionStorage.setItem('adminAuth', 'true');
    return true;
  }
  return false;
}

export function logoutAdmin() {
  sessionStorage.removeItem('adminAuth');
}