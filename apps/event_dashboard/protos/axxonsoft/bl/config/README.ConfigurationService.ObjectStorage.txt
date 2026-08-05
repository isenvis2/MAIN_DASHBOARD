MultimediaStorage
-----------------

I. Add MultimediaStorage

  * Archive Color

    id: "color"
    type: string
    example: "AliceBlue"


  * Storage Type (BlockStorage or ObjectStorage)

    id: "storage_type"
    type: "string"
    range: "block", "object"
    default: "block"

    Optional, "block" == BlockStorage (current), "object" == ObjectStorage


II. Add ObjectStorage Volume

  * Format flag
    id: "format"
    type: bool
    default: false

    Set to true if the new volume needs to be formatted. Used together with
    "volume_size" and "label".


  * New volume size
    id: "volume_size"
    type: uint64

    Required when "format" == true


  * New Volume Label
    id: "label"
    type: string
    default: ""

    New volume label to set during format


  * Auto mount
    id: "auto_mount"
    type: bool
    default: true

    Automatically mount volume on server start


  * Maximum block size
    id: "max_block_size_mb"
    type: int32
    range: [16, 512]
    default: 64

    Optional, EXPERT: Maximum block size to write to the underlying storage.


  * Optimal read size
    id: "optimal_read_size_mb"
    type: int32
    range: [1..max_block_size_mb/2)
    default: 4

    Optional, EXPERT.


  * Storage Writer Buffer Size

    id: "incoming_buffer_size_mb"
    type: int32
    range: >= 2 * max_block_size_mb
    default: 3 * max_block_size_mb

    Optional, EXPERT: maximum buffer size for incoming streams


  * Block Flush Period

    id: "block_flush_period_seconds"
    type: int32
    default: 60
    range: [30, 300]

    Optional, EXPERT: maximum wait period before the next block is written to
    the storage.


  * How often index data is saved
    id: "index_snapshot_max_block_distance"
    type: int32
    range: >= 16
    default: 256

    Optional, EXPERT


  * How long stream data can be gathered before submitting to storage
    id: "sequence_flush_period_seconds"
    type: int32
    default: 60
    range: > 30


  * Volume Connection Parameters
    id: "connection_params"

    See "ObjectStorage Volume Connection Parameters" section below


III. ObjectStorage Volume Connection Parameters

Connection parameters is a string->string map that provides full information on
how to connect to a volume. The actual set of parameters differ depending on the
connection 'schema'.

  id: "schema"
  type: string
  range: see possible values below

  1. Volume on a filesystem, schema='file'

    * "path" (string), REQUIRED. Path to a volume directory

    Ex: /mnt/datastore/aliceblue
    schema='file', path='/mnt/datastore/aliceblue'

    Ex: D:\AliceBlue
    schema='file', path='D:/AliceBlue'


  2. Volume on a SMB share, schema='smb'

    * "host" (string), REQUIRED. SMB server address.
    * "smb_share" (string), REQUIRED. SMB share name.
    * "path" (string), REQUIRED. Volume path on SMB share.
    * "smb_domain" (string), OPTIONAL.
    * "user" (string), OPTIONAL.
    * "password" (string), OPTIONAL.

    Ex: \\DATASERVER\video\AliceBlue, smb://DATASERVER/video/AliceBlue
    schema='smb', host='DATASERVER', smb_share='video', path='AliceBlue'


  3. Volume on Azure Blob Storage, schema='azure'

    * "protocol" (string), REQUIRED. Connection protocol, 'http' or 'https'.
    * "host" (string), REQUIRED. Azure server address.
    * "port" (string), OPTIONAL. Azure server port.
    * "container" (string), REQUIRED. Azure container name.
    * "user" (string), REQUIRED.
    * "access_key" (string) REQUIRED. Account access key, base64.
    * "path" (string), OPTIONAL. Azure root path

    Ex: Blob Storage on Microsoft Cloud

      https://myaccount:<access_key>@myaccount.blob.core.windows.net/aliceblue

      schema='azure' protocol='https' host='myaccount.blob.core.windows.net' user='myaccount'
        access_key='<access_key>' container='aliceblue'


    Ex: Self-hosted Blob Storage (Azure emulator)

      http://devstoreaccount1:<access_key>@192.168.0.32:10000/devstoreaccount1/aliceblue

      schema='azure' protocol='http' host='192.168.0.32', port='10000', user='devstoreaccount1'
        access_key='<access_key>' path='/devstoreaccount1' container='aliceblue'



IV. Remove ObjectStorage Volume

  Apart from usual, there is an extra property available during volume removal:

    id: "erase_volume_data"
    type: bool
    default: false

    OPTIONAL. Remove volume from the storage as well



Examples
--------

Add ObjectStorage Archive:

    "method": "axxonsoft.bl.config.ConfigurationService.ChangeConfig",
    "data": {
      "added": [ {
          "uid": "hosts/Node1",
          "units": [ {
              "type": "MultimediaStorage",
              "properties": [
                { "id": "display_name", "properties": [], "value_string": "Object storage" },
                { "id": "color", "properties": [], "value_string": "AliceBlue" },
                { "id": "storage_type", "value_int32": 1 }
      ] } ] } ],
      "changed": [],
      "removed": []
    }


Add Volume to ObjectStorage Archive:

  "method": "axxonsoft.bl.config.ConfigurationService.ChangeConfig",
    "data": {
      "added": [
        {
          "uid": "hosts/Node1/MultimediaStorage.AliceBlue",
          "units": [
            {
              "type": "ArchiveVolume",
              "properties": [
                {
                  "id": "connection_params",
                  "value_properties": {
                      "properties": [
                        { "id": "schema", "value_string": "file" },
                        { "id": "path", "value_string": "D:/AliceBlue" }
                  ] }
                },
                { "id": "label", "value_string": "Test archive" },
                { "id": "volume_size", "value_uint64": 4294967296 },
                { "id": "format", "value_bool": true }
      ] } ] } ],
      "changed": [],
      "removed": []
    }


