module.exports = async function (context, req) {
    const principal = req.headers['x-ms-client-principal'];
    if (principal) {
        const decodedPrincipal = Buffer.from(principal, 'base64').toString('utf8');
        const user = JSON.parse(decodedPrincipal);
        context.res = {
            body: {
                identityProviderAccessToken: user.identityProviderAccessToken,
                userId: user.userId,
                userDetails: user.userDetails
            }
        };
    } else {
        context.res = {
            status: 401,
            body: "Unauthorized"
        };
    }
};