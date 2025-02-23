async function loadProfile() {
    const userEmail = await getCurrentUserEmail();
    const token = await getAccessToken();
    const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userEmail)}?$select=displayName,surname,customSecurityAttributes`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
        const user = await response.json();
        const attrs = user.customSecurityAttributes?.FamilyHierarchy || {};
        document.getElementById('userName').value = user.displayName;
        document.getElementById('maritalStatus').value = attrs.MaritalStatus || 'Single';
        document.getElementById('spouseEmail').value = attrs.SpouseUPN || '';
        document.getElementById('parentUPN').value = (attrs.ParentUPN || []).join(', ') || '';
    }
}

async function updateProfile() {
    const userEmail = await getCurrentUserEmail();
    const maritalStatus = document.getElementById('maritalStatus').value;
    const spouseEmail = document.getElementById('spouseEmail').value;
    const parentUPNs = document.getElementById('parentUPN').value.split(',').map(u => u.trim()).filter(u => u);
    const token = await getAccessToken();
    const groups = await getUserGroups();
    if (!groups.includes('FamilySuperAdmins') && !groups.includes('FamilyMembers')) {
        alert('You don’t have permission to update your profile.');
        return;
    }
    if (!confirm('Are you sure you want to update your profile? This action is permanent.')) return;
    await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userEmail)}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            "customSecurityAttributes": {
                "FamilyHierarchy": {
                    "ParentUPN": parentUPNs,
                    "MaritalStatus": maritalStatus,
                    "SpouseUPN": spouseEmail || null
                }
            }
        })
    });
    alert('Profile updated.');
    loadFamilyTree();
}

function buildFamilyTree(users) {
    let tree = '<h3>Connected Family Tree</h3><ul>';
    users.filter(u => (u.customSecurityAttributes?.FamilyHierarchy?.ParentUPN || []).length > 0).forEach(user => {
        const parents = user.customSecurityAttributes?.FamilyHierarchy?.ParentUPN || [];
        const spouse = user.customSecurityAttributes?.FamilyHierarchy?.SpouseUPN || '';
        const maritalStatus = user.customSecurityAttributes?.FamilyHierarchy?.MaritalStatus || 'Single';
        const parentNames = parents.map(p => {
            const parent = users.find(u => u.mail === p);
            return parent ? parent.displayName : p;
        }).join(', ') || 'None';
        tree += `<li>${user.displayName} (${user.mail}) - Status: ${maritalStatus}, Spouse: ${spouse}, Parents: ${parentNames}</li>`;
    });
    tree += '</ul><h3>Orphaned Users</h3><ul>';
    users.filter(u => !(u.customSecurityAttributes?.FamilyHierarchy?.ParentUPN || []).length > 0).forEach(user => {
        tree += `<li>${user.displayName} (${user.mail}) <button onclick="connectOrphan('${user.mail}')">Connect</button></li>`;
    });
    tree += '</ul>';
    return tree;
}

async function connectOrphan(orphanEmail) {
    const userEmail = await getCurrentUserEmail();
    const token = await getAccessToken();
    const groups = await getUserGroups();
    if (!groups.includes('FamilySuperAdmins') && !groups.includes('FamilyMembers')) {
        alert('You don’t have permission to connect users.');
        return;
    }
    const relationship = prompt(`How is ${orphanEmail} related to you (e.g., parent, spouse, child, sibling)?`);
    if (!relationship || !confirm(`Are you sure you want to connect ${orphanEmail} as your ${relationship}? This action is permanent.`)) return;
    let parentUPNs = [userEmail];
    if (relationship.toLowerCase().includes('spouse')) {
        parentUPNs = [orphanEmail, userEmail]; // Bidirectional for spouses
        await updateSpouse(orphanEmail, userEmail);
    } else if (relationship.toLowerCase().includes('sibling')) {
        // Prompt for shared parents or create placeholders
        const sharedParents = prompt('Enter shared parent UPNs (comma-separated, e.g., mary.placeholder@feghali.org, michel.placeholder@feghali.org)');
        parentUPNs = sharedParents.split(',').map(p => p.trim()).filter(p => p);
        await updateHierarchy(orphanEmail, parentUPNs);
        await updateHierarchy(userEmail, parentUPNs);
    } else if (relationship.toLowerCase().includes('parent')) {
        parentUPNs = []; // Orphan becomes parent, user connects as child
        await updateHierarchy(userEmail, [orphanEmail]);
    } else if (relationship.toLowerCase().includes('child')) {
        await updateHierarchy(orphanEmail, [userEmail]);
    }
    await updateHierarchy(orphanEmail, parentUPNs, 'Married'); // Default to Married for spouses, adjust as needed
    alert('User connected.');
    loadFamilyTree();
}

async function updateHierarchy(email, parentUPNs, maritalStatus = null) {
    const token = await getAccessToken();
    await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            "customSecurityAttributes": {
                "FamilyHierarchy": {
                    "ParentUPN": parentUPNs,
                    "MaritalStatus": maritalStatus || (await getProfile(email)).MaritalStatus
                }
            }
        })
    });
}

async function updateSpouse(email, spouseEmail) {
    const token = await getAccessToken();
    await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            "customSecurityAttributes": {
                "FamilyHierarchy": {
                    "SpouseUPN": spouseEmail,
                    "MaritalStatus": "Married"
                }
            }
        })
    });
}