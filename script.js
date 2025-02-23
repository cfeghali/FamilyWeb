async function loadHierarchy() {
    try {
        const response = await fetch('/api/GetFamilyHierarchy');
        if (response.ok) {
            const hierarchy = await response.json();
            const treeData = hierarchy.family.map(group => ({
                text: group.name,
                children: group.members.map(member => ({
                    text: `${member.name} (${member.email})`,
                    data: member
                }))
            }));

            $('#hierarchy').jstree({
                'core': {
                    'data': treeData
                },
                'plugins': ['dnd']
            });

            // Initialize SortableJS for drag-and-drop functionality
            new Sortable(document.getElementById('hierarchy'), {
                group: 'family',
                animation: 150,
                onEnd: function (evt) {
                    // Handle the drop event
                    const item = evt.item;
                    const newParent = evt.to;
                    console.log(`Moved ${item.textContent} to ${newParent.id}`);
                }
            });
        } else {
            throw new Error('Failed to load hierarchy');
        }
    } catch (error) {
        console.error('Error loading hierarchy:', error);
        document.getElementById('hierarchy').innerHTML = '<p>Error loading hierarchy.</p>';
    }
}