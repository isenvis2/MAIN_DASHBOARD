General concept
---------------

The permissions to perform certain operations are assigned to specific roles.
Users are not assigned permissions directly, but only acquire them through their
role (or roles).

The permissions to access system objects (such as cameras, archives, microphones
and etc) are also assigned only to roles. Effective rights to an object are
calculated based on the specified objects, groups and global permissions.

Objects permissions
-------------------

Objects permissions have maximum priority in calculation of effective rights.

Groups permissions
------------------

Cameras can be grouped. If objects permissions are not specified for a camera
(or its linked components), effective rights are calculated by permissions to
the camera's groups. If permissions to a group are not specified, permissions
of its parent group are used.

Global permissions
-------------------

A role may be marked as a "superuser" role, i.e it will have unrestricted access
to perform any operations to any objects.

If neither objects nor groups permissions are specified, access to system
objects are granted based on default permissions of a role.
