let debugEnabled = false;

function log(message) {
    if (debugEnabled) {
        const logs = document.getElementById('debug-logs');
        logs.style.display = 'block';
        logs.innerHTML += `<p>${new Date().toISOString()} - ${message}</p>`;
        logs.scrollTop = logs.scrollHeight;
    }
    console.log(message); // Also log to browser console for development
}

async function login() {
    log('Attempting to login with Microsoft Entra ID');
    window.location.href = '/.auth/login/aad';
}

async function logout() {
    log('Attempting to logout');
    window.location.href = '/.auth/logout';
}

async function checkAuthAndUpdateButton() {
    log('Checking authentication status');
    const response = await fetch('/.auth/me');
    const button = document.getElementById('auth-button');
    if (response.ok) {
        const data = await response.json();
        log(`Authenticated as ${data.clientPrincipal.userDetails} (${data.clientPrincipal.userId})`);
        document.getElementById('user-info').innerHTML = `Welcome, ${data.clientPrincipal.userDetails} (${data.clientPrincipal.userId})`;
        button.innerHTML = `<button onclick="logout()">Log Out <span class="user-icon">👤</span></button>`;
    } else {
        log('Not authenticated');
        button.innerHTML = '<button onclick="login()">Login with Microsoft</button>';
        document.getElementById('user-info').innerHTML = '';
    }
}

async function getUserInfo() {
    log('Loading user information');
    await checkAuthAndUpdateButton();
    const response = await fetch('/.auth/me');
    if (response.ok) {
        const data = await response.json();
        const userEmail = data.clientPrincipal.userId;
        log(`User info loaded for ${userEmail}`);
        document.getElementById('userEmail').value = userEmail;
        document.getElementById('userName').value = data.clientPrincipal.userDetails;
        loadFamilyTree();
        loadOrphans();
        loadProfile();
        setupAutocomplete();
    } else {
        log(`Failed to get user info: ${response.status} - ${response.statusText}`);
    }
}

async function loadFamilyTree() {
    log('Loading family tree');
    const token = await getAccessToken();
    if (!token) {
        log('No access token available');
        return;
    }
    const response = await fetch('https://graph.microsoft.com/v1.0/users?$select=mail,displayName,surname,customSecurityAttributes', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
        const users = await response.json().value;
        log(`Loaded ${users.length} users for family tree`);
        const tree = buildFamilyTree(users);
        document.getElementById('family-tree').innerHTML = tree;
        setupDragAndDrop(users);
    } else {
        log(`Failed to load family tree: ${response.status} - ${response.statusText}`);
    }
}

async function loadOrphans() {
    log('Loading orphaned users');
    const token = await getAccessToken();
    if (!token) {
        log('No access token available for orphans');
        return;
    }
    const excludeList = await getExcludeList();
    const response = await fetch('https://graph.microsoft.com/v1.0/users?$filter=customSecurityAttributes/FamilyHierarchy/ParentUPN eq null&$select=mail,displayName,surname,customSecurityAttributes', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
        const users = await response.json().value.filter(u => !excludeList.includes(u.mail));
        log(`Loaded ${users.length} orphaned users`);
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
    } else {
        log(`Failed to load orphans: ${response.status} - ${response.statusText}`);
    }
}

function dragStart(ev) {
    log(`Starting drag for ${ev.target.dataset.email}`);
    ev.dataTransfer.setData("text/plain", ev.target.dataset.email);
}

async function setupDragAndDrop(users) {
    log('Setting up drag-and-drop functionality');
    interact('.dropzone').dropzone({
        accept: '.draggable',
        ondrop: async (event) => {
            const orphanEmail = event.relatedTarget.dataset.email;
            log(`Dropped orphaned user ${orphanEmail}`);
            await connectOrphan(orphanEmail);
        },
        ondragenter: (event) => {
            event.target.classList.add('dragover');
            log('Drag entered dropzone');
        },
        ondragleave: (event) => {
            event.target.classList.remove('dragover');
            log('Drag left dropzone');
        }
    });

    document.querySelectorAll('li').forEach(item => {
        item.classList.add('draggable');
    });
}

async function loadProfile() {
    log('Loading user profile');
    const userEmail = await getCurrentUserEmail();
    const token = await getAccessToken();
    if (!token) {
        log('No access token available for profile');
        return;
    }
    const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userEmail)}?$select=displayName,surname,customSecurityAttributes`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
        const user = await response.json();
        log(`Profile loaded for ${userEmail}`);
        const attrs = user.customSecurityAttributes?.FamilyHierarchy || {};
        document.getElementById('userName').value = user.displayName;
        document.getElementById('maritalStatus').value = attrs.MaritalStatus || 'Single';
        document.getElementById('spouseName').value = attrs.SpouseUPN ? (users.find(u => u.mail === attrs.SpouseUPN)?.displayName + ' ' + users.find(u => u.mail === attrs.SpouseUPN)?.surname || '') : '';
        document.getElementById('parentName').value = (attrs.ParentUPN || []).map(p => users.find(u => u.mail === p)?.displayName + ' ' + users.find(u => u.mail === p)?.surname || p).join(', ') || '';
    } else {
        log(`Failed to load profile: ${response.status} - ${response.statusText}`);
    }
}

async function updateProfile() {
    log('Attempting to update profile');
    const userEmail = await getCurrentUserEmail();
    const maritalStatus = document.getElementById('maritalStatus').value;
    const spouseEmail = await getEmailFromName(document.getElementById('spouseName').value);
    const parentEmails = await getEmailsFromNames(document.getElementById('parentName').value.split(',').map(p => p.trim()).filter(p => p));
    const token = await getAccessToken();
    if (!token) {
        log('No access token available for profile update');
        alert('You don’t have permission to update your profile due to authentication issues.');
        return;
    }
    const groups = await getUserGroups();
    if (!groups.includes('FamilySuperAdmins') && !groups.includes('FamilyMembers')) {
        log(`Permission denied for ${userEmail} - Not in FamilySuperAdmins or FamilyMembers`);
        alert('You don’t have permission to update your profile.');
        return;
    }
    if (!confirm('Are you sure you want to update your profile? This action is permanent.')) {
        log('Profile update cancelled by user');
        return;
    }
    const [firstName, ...lastNameParts] = document.getElementById('userName').value.split(' ');
    const currentLastName = lastNameParts.join(' ') || '';
    const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userEmail)}`, {
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
    if (response.ok) {
        log(`Profile updated successfully for ${userEmail}`);
        alert('Profile updated.');
        loadFamilyTree();
    } else {
        log(`Failed to update profile: ${response.status} - ${await response.text()}`);
        alert('Failed to update profile. Check debug logs for details.');
    }
}

async function connectOrphan(orphanEmail) {
    log(`Attempting to connect orphaned user ${orphanEmail}`);
    const userEmail = await getCurrentUserEmail();
    const token = await getAccessToken();
    if (!token) {
        log('No access token available for connecting orphan');
        return;
    }
    const groups = await getUserGroups();
    if (!groups.includes('FamilySuperAdmins') && !groups.includes('FamilyMembers')) {
        log(`Permission denied for ${userEmail} - Not in FamilySuperAdmins or FamilyMembers`);
        alert('You don’t have permission to connect users.');
        return;
    }
    const relationship = prompt(`How is ${orphanEmail} related to you (e.g., parent, spouse, child, sibling)?`);
    if (!relationship || !confirm(`Are you sure you want to connect ${orphanEmail} as your ${relationship}? This action is permanent.`)) {
        log('Orphan connection cancelled by user');
        return;
    }
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
    const response = await updateHierarchy(orphanEmail, parentUPNs, 'Married'); // Default to Married for spouses, adjust as needed
    if (response.ok) {
        log(`Successfully connected ${orphanEmail} to ${userEmail} as ${relationship}`);
        alert('User connected.');
    } else {
        log(`Failed to connect orphan: ${response.status} - ${await response.text()}`);
        alert('Failed to connect user. Check debug logs for details.');
    }
    loadOrphans();
    loadFamilyTree();
}

async function createOrConnectUser() {
    log('Attempting to create or connect user');
    const email = document.getElementById('newUserEmail').value;
    const name = document.getElementById('newUserName').value;
    const lastName = document.getElementById('newUserLastName').value;
    const parentEmail = await getEmailFromName(document.getElementById('newParentName').value);
    const token = await getAccessToken();
    if (!token) {
        log('No access token available for creating/connecting user');
        alert('You don’t have permission to create or connect users due to authentication issues.');
        return;
    }
    const groups = await getUserGroups();
    if (!groups.includes('FamilySuperAdmins') && !groups.includes('FamilyMembers')) {
        log(`Permission denied - Not in FamilySuperAdmins or FamilyMembers`);
        alert('You don’t have permission to create or connect users.');
        return;
    }
    if (!confirm(`Are you sure you want to create/connect ${name} ${lastName} (${email}) with parent ${parentEmail || 'None'}? This action is permanent.`)) {
        log('User creation/connection cancelled by user');
        return;
    }
    const response = await fetch(`https://graph.microsoft.com/v1.0/users?$filter=mail eq '${encodeURIComponent(email)}'`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
        const existing = await response.json().value;
        if (existing.length > 0) {
            log(`Connecting existing orphaned user ${email}`);
            await connectOrphan(email);
        } else {
            const createResponse = await fetch(`https://graph.microsoft.com/v1.0/users`, {
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
            if (createResponse.ok) {
                log(`Successfully created/connected user ${email}`);
                alert('User created/connected. They need to reset their password via Entra ID SSPR and update their profile.');
            } else {
                log(`Failed to create/connect user: ${createResponse.status} - ${await createResponse.text()}`);
                alert('Failed to create/connect user. Check debug logs for details.');
            }
        }
    } else {
        log(`Failed to check existing user: ${response.status} - ${await response.text()}`);
        alert('Failed to check user existence. Check debug logs for details.');
    }
    loadOrphans();
    loadFamilyTree();
}

async function resetPassword() {
    const userEmail = document.getElementById('newUserEmail').value || await getCurrentUserEmail();
    log(`Password reset requested for ${userEmail}`);
    alert(`Password reset link sent to ${userEmail}. User must use Entra ID SSPR at https://passwordreset.microsoftonline.com`);
}

async function getCurrentUserEmail() {
    const response = await fetch('/.auth/me');
    if (response.ok) {
        const data = await response.json();
        log(`Current user email: ${data.clientPrincipal.userId}`);
        return data.clientPrincipal.userId;
    }
    log(`Failed to get current user email: ${response.status} - ${response.statusText}`);
    return null;
}

async function getAccessToken() {
    try {
        log('Attempting to retrieve access token');
        const response = await fetch('/.auth/me');
        if (!response.ok) {
            throw new Error(`Failed to get access token: ${response.status} - ${response.statusText}`);
        }
        const data = await response.json();
        const token = data.clientPrincipal?.identityProviderAccessToken;
        if (!token) {
            throw new Error('No access token in response');
        }
        log('Access token retrieved successfully');
        return token;
    } catch (error) {
        log(`Error retrieving access token: ${error.message}`);
        return null;
    }
}

async function getUserGroups() {
    const token = await getAccessToken();
    if (!token) {
        log('No access token available for getting user groups');
        return [];
    }
    const response = await fetch('https://graph.microsoft.com/v1.0/me/memberOf', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
        const groups = await response.json().value;
        log(`User groups: ${groups.map(g => g.displayName).join(', ')}`);
        return groups.map(g => g.displayName);
    }
    log(`Failed to get user groups: ${response.status} - ${response.statusText}`);
    return [];
}

async function getExcludeList() {
    const token = await getAccessToken();
    if (!token) {
        log('No access token available for exclude list');
        return [];
    }
    const response = await fetch('https://graph.microsoft.com/v1.0/groups/FamilyNonMembers/members', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
        const members = await response.json().value;
        log(`Exclude list loaded: ${members.map(m => m.mail).join(', ')}`);
        return members.map(m => m.mail);
    }
    log(`Failed to get exclude list: ${response.status} - ${response.statusText}`);
    return [];
}

async function updateHierarchy(email, parentUPNs, maritalStatus = null) {
    const token = await getAccessToken();
    if (!token) {
        log('No access token available for updating hierarchy');
        return { ok: false, status: 401, text: 'Unauthorized' };
    }
    const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}`, {
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
    log(`Hierarchy update for ${email}: ${response.status} - ${await response.text()}`);
    return response;
}

async function updateSpouse(email, spouseEmail) {
    const token = await getAccessToken();
    if (!token) {
        log('No access token available for updating spouse');
        return { ok: false, status: 401, text: 'Unauthorized' };
    }
    const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}`, {
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
    log(`Spouse update for ${email} to ${spouseEmail}: ${response.status} - ${await response.text()}`);
    return response;
}

async function getProfile(email) {
    const token = await getAccessToken();
    if (!token) {
        log('No access token available for getting profile');
        return {};
    }
    const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}?$select=customSecurityAttributes`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
        log(`Profile retrieved for ${email}`);
        return response.json().customSecurityAttributes?.FamilyHierarchy || {};
    }
    log(`Failed to get profile for ${email}: ${response.status} - ${response.statusText}`);
    return {};
}

async function getEmailFromName(name) {
    const token = await getAccessToken();
    if (!token) {
        log('No access token available for getting email from name');
        return null;
    }
    const [displayName, surname] = name.trim().split(' ').filter(Boolean);
    const response = await fetch(`https://graph.microsoft.com/v1.0/users?$filter=startsWith(displayName, '${encodeURIComponent(displayName)}') and startsWith(surname, '${encodeURIComponent(surname || '')}')&$select=mail,displayName,surname`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
        const users = await response.json().value;
        log(`Found email for ${name}: ${users.length > 0 ? users[0].mail : 'None'}`);
        return users.length > 0 ? users[0].mail : null;
    }
    log(`Failed to get email from name ${name}: ${response.status} - ${response.statusText}`);
    return null;
}

async function getEmailsFromNames(names) {
    const token = await getAccessToken();
    if (!token) {
        log('No access token available for getting emails from names');
        return [];
    }
    const emails = [];
    for (const name of names) {
        const [displayName, surname] = name.trim().split(' ').filter(Boolean);
        const response = await fetch(`https://graph.microsoft.com/v1.0/users?$filter=startsWith(displayName, '${encodeURIComponent(displayName)}') and startsWith(surname, '${encodeURIComponent(surname || '')}')&$select=mail,displayName,surname`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            const users = await response.json().value;
            if (users.length > 0) {
                log(`Found email for ${name}: ${users[0].mail}`);
                emails.push(users[0].mail);
            } else {
                log(`No user found for ${name}`);
            }
        } else {
            log(`Failed to get email for ${name}: ${response.status} - ${response.statusText}`);
        }
    }
    return emails;
}

function setupAutocomplete() {
    const inputs = ['spouseName', 'parentName', 'newParentName'];
    inputs.forEach(inputId => {
        const input = document.getElementById(inputId);
        const datalist = document.getElementById(`${inputId}-options`);
        let timeoutId = null;
        input.addEventListener('input', async () => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(async () => {
                const token = await getAccessToken();
                if (!token) {
                    log('No access token available for autocomplete');
                    return;
                }
                const searchTerm = input.value;
                const [displayName, surname] = searchTerm.trim().split(' ').filter(Boolean);
                try {
                    const response = await fetch(`https://graph.microsoft.com/v1.0/users?$filter=startsWith(displayName, '${encodeURIComponent(displayName)}') and startsWith(surname, '${encodeURIComponent(surname || '')}')&$select=mail,displayName,surname`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (response.ok) {
                        const users = await response.json().value;
                        log(`Autocomplete results for ${searchTerm}: ${users.length} users`);
                        datalist.innerHTML = '';
                        users.forEach(user => {
                            const option = document.createElement('option');
                            option.value = `${user.displayName} ${user.surname}`;
                            option.dataset.email = user.mail;
                            datalist.appendChild(option);
                        });
                    } else {
                        log(`Failed autocomplete for ${searchTerm}: ${response.status} - ${response.statusText}`);
                    }
                } catch (error) {
                    log(`Error during autocomplete fetch: ${error.message}`);
                }
            }, 300); // Debounce input by 300ms to reduce rapid API calls
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
    log('Family tree built');
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
    log('Parent dropdown populated');
}

function toggleDebug() {
    debugEnabled = !debugEnabled;
    const logs = document.getElementById('debug-logs');
    logs.style.display = debugEnabled ? 'block' : 'none';
    log(`Debug logging ${debugEnabled ? 'enabled' : 'disabled'}`);
}

window.onload = async () => {
    log('Page loaded');
    await getUserInfo();
};