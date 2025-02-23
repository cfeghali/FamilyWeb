function login() {
    window.location.href = '/.auth/login/aad';
}

async function getUserInfo() {
    const response = await fetch('/.auth/me');
    if (response.ok) {
        const data = await response.json();
        document.getElementById('user-info').innerHTML = `Welcome, ${data.clientPrincipal.userDetails} (${data.clientPrincipal.userId})`;
    }
}

async function loadHierarchy() {
    // Placeholder for fetching family hierarchy via API (we’ll add this later)
    document.getElementById('hierarchy').innerHTML = '<p>Family hierarchy will appear here after setup.</p>';
}

// Load user info and hierarchy when the page loads
window.onload = async () => {
    await getUserInfo();
    await loadHierarchy();
};