async function login() {
    window.location.href = '/.auth/login/aad';
}

async function logout() {
    window.location.href = '/.auth/logout';
}

async function checkAuthAndUpdateButton() {
    const response = await fetch('/.auth/me');
    const button = document.getElementById('auth-button');
    if (response.ok) {
        const data = await response.json();
        document.getElementById('user-info').innerHTML = `Welcome, ${data.clientPrincipal.userDetails} (${data.clientPrincipal.userId})`;
        button.innerHTML = `<button onclick="logout()">Log Out <span class="user-icon">👤</span></button>`;
    } else {
        button.innerHTML = '<button onclick="login()">Login with Microsoft</button>';
        document.getElementById('user-info').innerHTML = '';
    }
}

async function getUserInfo() {
    await checkAuthAndUpdateButton();
    const response = await fetch('/.auth/me');
    if (response.ok) {
        const data = await response.json();
        const userEmail = data.clientPrincipal.userId;
        document.getElementById('userEmail').value = userEmail;
        document.getElementById('userName').value = data.clientPrincipal.userDetails;
        loadFamilyTree();
        loadOrphans();
        loadProfile();
        setupAutocomplete();
    }
}

async function loadFamilyTree() {
    const token = await getAccessToken();
    const response = await fetch('https://graph.microsoft.com/v1.0/users?$select=mail,displayName,surname,customSecurityAttributes', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
        const users = await response.json().value;
        const tree = buildFamilyTree(users);
        document.getElementById('family-tree').innerHTML = tree;
        setupDragAndDrop(users);
    }
}

async function loadOrphans() {
    const token = await getAccessToken();
    const excludeList = await getExcludeList();
    const response = await fetch('https://graph.microsoft.com/v1.0/users?$filter=customSecurityAttributes/FamilyHierarchy/ParentUPN eq null&$select=mail,displayName,surname,customSecurityAttributes', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
        const users = await response.json().value.filter(u => !excludeList.includes(u.mail));
        const list = document.getElementById('orphaned-list');
        list.innerHTML = '';
        if (users.length > 0) {
            document.getElementById('orphaned-users').style.display = 'block';
            users.forEach(user => {
                const li = document.createElement('li');
                li.textContent = `${user.displayName} ${user.surname} (${user.mail})`;
                li.draggable = true;
                li.dataset.email = user.mail;
                li.addEventListener('dragstart', dragStart);
                list.appendChild(li);
            });
        } else {
            document.getElementById('orphaned-users').style.display = 'none';
        }
    }
}

function dragStart(ev) {
    ev.dataTransfer.setData("text/plain", ev.target.dataset.email);
}

async function setupDragAndDrop(users) {
    interact('.dropzone').dropzone({
        accept: '.draggable',
        ondrop: async (event) => {
            const orphanEmail = event.relatedTarget.dataset.email;
            await connectOrphan(orphanEmail);
        }
    });

    document.querySelectorAll('li').forEach(item => {
        item.classList.add('draggable');
    });
}

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
        document.getElementById('spouseName').value = attrs.SpouseUPN ? (users.find(u => u.mail === attrs.SpouseUPN)?.displayName + ' ' + users.find(u => u.mail === attrs.SpouseUPN)?.surname || '') : '';
        document.getElementById('parentName').value = (attrs.ParentUPN || []).map(p => users.find(u => u.mail === p)?.displayName + ' ' + users.find(u => u.mail === p)?.surname || p).join(', ') || '';
    }
}

async function updateProfile() {
    const userEmail = await getCurrentUserEmail();
    const maritalStatus = document.getElementById('maritalStatus').value;
    const spouseEmail = await getEmailFromName(document.getElementById('spouseName').value);
    const parentEmails = await getEmailsFromNames(document.getElementById('parentName').value.split(',').map(p => p.trim()).filter(p => p));
    const token = await getAccessToken();
    const groups = await getUserGroups();
    if (!groups.includes('FamilySuperAdmins') && !groups.includes('FamilyMembers')) {
        alert('You don’t have permission to update your profile.');
        return;
    }
    if (!confirm('Are you sure you want to update your profile? This action is permanent.')) return;
    const [firstName, ...lastNameParts] = document.getElementById('userName').value.split(' ');
    const currentLastName = lastNameParts.join(' ') || '';
    await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userEmail)}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            "displayName": `${firstName} ${currentLastName}`,
            "surname": currentLastName,
            "customSecurityAttributes": {
                "FamilyHierarchy": {
                    "ParentUPN": parentEmails,
                    "MaritalStatus": maritalStatus,
                    "SpouseUPN": spouseEmail || null
                }
            }
        })
    });
    alert('Profile updated.');
    loadFamilyTree();
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
        const sharedParents = prompt('Enter shared parent full names (comma-separated, e.g., Mary Feghali, Michel Feghali)');
        parentUPNs = await getEmailsFromNames(sharedParents.split(',').map(p => p.trim()).filter(p => p));
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
    loadOrphans();
    loadFamilyTree();
}

async function createOrConnectUser() {
    const email = document.getElementById('newUserEmail').value;
    const name = document.getElementById('newUserName').value;
    const lastName = document.getElementById('newUserLastName').value;
    const parentEmail = await getEmailFromName(document.getElementById('newParentName').value);
    const token = await getAccessToken();
    const groups = await getUserGroups();
    if (!groups.includes('FamilySuperAdmins') && !groups.includes('FamilyMembers')) {
        alert('You don’t have permission to create or connect users.');
        return;
    }
    if (!confirm(`Are you sure you want to create/connect ${name} ${lastName} (${email}) with parent ${parentEmail || 'None'}? This action is permanent.`)) return;
    const response = await fetch(`https://graph.microsoft.com/v1.0/users?$filter=mail eq '${encodeURIComponent(email)}'`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
        const existing = await response.json().value;
        if (existing.length > 0) {
            await connectOrphan(email); // Treat as connecting an existing orphaned user
        } else {
            await fetch(`https://graph.microsoft.com/v1.0/users`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    "accountEnabled": true,
                    "displayName": `${name} ${lastName}`,
                    "mailNickname": email.split('@')[0],
                    "userPrincipalName": email,
                    "surname": lastName,
                    "passwordProfile": {
                        "forceChangePasswordNextSignIn": true,
                        "password": "TemporaryPassword123!" // Replace with a secure, generated password
                    },
                    "customSecurityAttributes": {
                        "FamilyHierarchy": {
                            "ParentUPN": [parentEmail].filter(p => p),
                            "MaritalStatus": "Single", // Default; user can update later
                            "SpouseUPN": null
                        }
                    }
                })
            });
            alert('User created/connected. They need to reset their password via Entra ID SSPR and update their profile.');
        }
    }
    loadOrphans();
    loadFamilyTree();
}

async function resetPassword() {
    const userEmail = document.getElementById('newUserEmail').value || await getCurrentUserEmail();
    alert(`Password reset link sent to ${userEmail}. User must use Entra ID SSPR at https://passwordreset.microsoftonline.com`);
}

async function getCurrentUserEmail() {
    const response = await fetch('/.auth/me');
    if (response.ok) {
        const data = await response.json();
        return data.clientPrincipal.userId;
    }
    return null;
}

async function getAccessToken() {
    const response = await fetch('/.auth/me');
    if (response.ok) {
        const data = await response.json();
        return data.clientPrincipal.identityProviderAccessToken;
    }
    return null;
}

async function getUserGroups() {
    const token = await getAccessToken();
    const response = await fetch('https://graph.microsoft.com/v1.0/me/memberOf', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
        const groups = await response.json().value;
        return groups.map(g => g.displayName);
    }
    return [];
}

async function getExcludeList() {
    const token = await getAccessToken();
    const response = await fetch('https://graph.microsoft.com/v1.0/groups/FamilyNonMembers/members', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
        const members = await response.json().value;
        return members.map(m => m.mail);
    }
    return [];
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

async function getProfile(email) {
    const token = await getAccessToken();
    const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}?$select=customSecurityAttributes`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
        return response.json().customSecurityAttributes?.FamilyHierarchy || {};
    }
    return {};
}

async function getEmailFromName(name) {
    const token = await getAccessToken();
    const [displayName, surname] = name.trim().split(' ').filter(Boolean);
    const response = await fetch(`https://graph.microsoft.com/v1.0/users?$filter=startsWith(displayName, '${encodeURIComponent(displayName)}') and startsWith(surname, '${encodeURIComponent(surname || '')}')&$select=mail,displayName,surname`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
        const users = await response.json().value;
        return users.length > 0 ? users[0].mail : null;
    }
    return null;
}

async function getEmailsFromNames(names) {
    const token = await getAccessToken();
    const emails = [];
    for (const name of names) {
        const [displayName, surname] = name.trim().split(' ').filter(Boolean);
        const response = await fetch(`https://graph.microsoft.com/v1.0/users?$filter=startsWith(displayName, '${encodeURIComponent(displayName)}') and startsWith(surname, '${encodeURIComponent(surname || '')}')&$select=mail,displayName,surname`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            const users = await response.json().value;
            if (users.length > 0) emails.push(users[0].mail);
        }
    }
    return emails;
}

function setupAutocomplete() {
    const inputs = ['spouseName', 'parentName', 'newParentName'];
    inputs.forEach(inputId => {
        const input = document.getElementById(inputId);
        const datalist = document.getElementById(`${inputId}-options`);
        input.addEventListener('input', async () => {
            const token = await getAccessToken();
            const searchTerm = input.value;
            const [displayName, surname] = searchTerm.trim().split(' ').filter(Boolean);
            const response = await fetch(`https://graph.microsoft.com/v1.0/users?$filter=startsWith(displayName, '${encodeURIComponent(displayName)}') and startsWith(surname, '${encodeURIComponent(surname || '')}')&$select=mail,displayName,surname`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const users = await response.json().value;
                datalist.innerHTML = '';
                users.forEach(user => {
                    const option = document.createElement('option');
                    option.value = `${user.displayName} ${user.surname}`;
                    option.dataset.email = user.mail;
                    datalist.appendChild(option);
                });
            }
        });
    });
}

function buildFamilyTree(users) {
    let tree = '<h3>Connected Family Tree</h3><ul>';
    users.filter(u => (u.customSecurityAttributes?.FamilyHierarchy?.ParentUPN || []).length > 0).forEach(user => {
        const parents = user.customSecurityAttributes?.FamilyHierarchy?.ParentUPN || [];
        const spouse = user.customSecurityAttributes?.FamilyHierarchy?.SpouseUPN || '';
        const maritalStatus = user.customSecurityAttributes?.FamilyHierarchy?.MaritalStatus || 'Single';
        const parentNames = parents.map(p => {
            const parent = users.find(u => u.mail === p);
            return parent ? `${parent.displayName} ${parent.surname}` : p;
        }).join(', ') || 'None';
        tree += `<li>${user.displayName} ${user.surname} (${user.mail}) - Status: ${maritalStatus}, Spouse: ${spouse ? users.find(u => u.mail === spouse)?.displayName + ' ' + users.find(u => u.mail === spouse)?.surname : ''}, Parents: ${parentNames}</li>`;
    });
    tree += '</ul><h3>Orphaned Users</h3><ul>';
    users.filter(u => !(u.customSecurityAttributes?.FamilyHierarchy?.ParentUPN || []).length > 0).forEach(user => {
        tree += `<li>${user.displayName} ${user.surname} (${user.mail}) <button onclick="connectOrphan('${user.mail}')">Connect</button></li>`;
    });
    tree += '</ul>';
    return tree;
}

function populateParentDropdown(users) {
    const select = document.getElementById('newParentName');
    users.forEach(user => {
        const option = document.createElement('option');
        option.value = `${user.displayName} ${user.surname}`;
        option.dataset.email = user.mail;
        select.appendChild(option);
    });
}

window.onload = async () => {
    await getUserInfo();
};