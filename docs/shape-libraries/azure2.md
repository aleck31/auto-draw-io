# azure2

**Type:** SVG images
**Path:** `img/lib/azure2/`

## Usage

```xml
<mxCell value="label" style="image;aspect=fixed;image=img/lib/azure2/compute/Virtual_Machine.svg;verticalLabelPosition=bottom;verticalAlign=top;align=center;" vertex="1" parent="1">
  <mxGeometry x="0" y="0" width="60" height="60" as="geometry" />
</mxCell>
```

## Architecture diagram design guide

An architecture diagram is a high-level LOGICAL map, not a sequence diagram. Its
job is to let a reader grasp in one glance **what the pieces are, how they are
grouped, and how they relate** - not to trace runtime message order.

**Grouping carries most of the meaning.** Nest containers in the real cloud
structure (cloud -> region -> virtual network -> subnets, plus subscription /
project / account boundaries and on-prem data centers). A reader learns more from
"these five services form the ingestion tier" than from ten arrows between them.
Prefer flow BETWEEN tiers/groups over flow between individual nodes.

**Naming:**
- Label each service node with the official service name; put custom context in a
  second line / smaller caption.
- Label a structural container by what its boundary IS, matching its kind
  (a virtual network box -> "VNet"/"VPC", a private subnet box -> "Private
  Subnet") - not a free-form tier name.
- Free-form tier names ("Application Tier", "Edge & Auth") belong on a plain
  generic container, not on a network/region boundary.
- A colored service group represents ONE service and holds only that service's
  own parts; a box mixing different services must be a neutral generic container.

**Connectors:**
- Draw the fewest connectors that convey the logical shape; merge a read+write
  into one link and skip reverse arrows for responses.
- One connector to a group container, not one per member.
- Keep one dominant flow direction; never route a connector through an unrelated
  shape's bounding box.

**Complex multi-step flows:** use small numbered step markers on the nodes plus a
legend listing the steps, instead of a web of long labeled arrows.

**Before emitting XML**, self-check: understandable in ten seconds? one obvious
flow direction? connectors <= nodes? no connector carrying a sentence or doubling
back across the canvas?


## Shapes (701)

Shapes are organized by category: `azure2/{category}/{shape}.svg`

### ai_machine_learning (42)

- `AI_Foundry`
- `AI_Foundry_IQ`
- `AI_Studio`
- `Anomaly_Detector`
- `Azure_Applied_AI`
- `Azure_Experimentation_Studio`
- `Azure_Machine_Learning`
- `Azure_Object_Understanding`
- `Azure_OpenAI`
- `Batch_AI`
- `Bonsai`
- `Bot_Services`
- `Cognitive_Services`
- `Cognitive_Services_Decisions`
- `Computer_Vision`
- `Content_Moderators`
- `Content_Safety`
- `Custom_Vision`
- `Face_APIs`
- `Form_Recognizers`
- `Foundry_Agent_Service`
- `Foundry_Application`
- `Foundry_Control_Plane`
- `Foundry_Labs`
- `Foundry_Local`
- `Foundry_Models`
- `Foundry_Project`
- `FRD_QA`
- `Genomics`
- `Immersive_Readers`
- `Language_Services`
- `Language_Understanding`
- `Machine_Learning`
- `Machine_Learning_Studio_Classic_Web_Services`
- `Machine_Learning_Studio_Web_Service_Plans`
- `Machine_Learning_Studio_Workspaces`
- `Personalizers`
- `Planetary_Computer_Pro`
- `QnA_Makers`
- `Serverless_Search`
- `Speech_Services`
- `Translator_Text`

### analytics (14)

- `Analysis_Services`
- `Azure_Databricks`
- `Azure_Synapse_Analytics`
- `Azure_Workbooks`
- `Data_Lake_Analytics`
- `Data_Lake_Store_Gen1`
- `Endpoint_Analytics`
- `Event_Hub_Clusters`
- `Event_Hubs`
- `HD_Insight_Clusters`
- `Log_Analytics_Workspaces`
- `Power_BI_Embedded`
- `Power_Platform`
- `Stream_Analytics_Jobs`

### app_services (9)

- `API_Management_Services`
- `App_Service_Certificates`
- `App_Service_Domains`
- `App_Service_Environments`
- `App_Service_Plans`
- `App_Services`
- `CDN_Profiles`
- `Notification_Hubs`
- `Search_Services`

### azure_ecosystem (3)

- `Applens`
- `Azure_Hybrid_Center`
- `Collaborative_Service`

### azure_stack (8)

- `Azure_Stack`
- `Capacity`
- `Infrastructure_Backup`
- `Multi_Tenancy`
- `Offers`
- `Plans`
- `Updates`
- `User_Subscriptions`

### azure_vmware_solution (1)

- `AVS`

### blockchain (6)

- `ABS_Member`
- `Azure_Blockchain_Service`
- `Azure_Token_Service`
- `Blockchain_Applications`
- `Consortium`
- `Outbound_Connection`

### compute (40)

- `App_Services`
- `Application_Group`
- `Automanaged_VM`
- `Availability_Sets`
- `Azure_Compute_Galleries`
- `Azure_Linux`
- `Azure_Spring_Cloud`
- `Batch_Accounts`
- `Cloud_Services_Classic`
- `Container_Instances`
- `Container_Services_Deprecated`
- `Disk_Encryption_Sets`
- `Disks`
- `Disks_Snapshots`
- `Function_Apps`
- `Host_Groups`
- `Host_Pools`
- `Hosts`
- `Image_Definitions`
- `Image_Templates`
- `Image_Versions`
- `Images`
- `Kubernetes_Services`
- `Maintenance_Configuration`
- `Managed_Service_Fabric`
- `Mesh_Applications`
- `Metrics_Advisor`
- `OS_Images_Classic`
- `Restore_Points`
- `Restore_Points_Collections`
- `Scheduled_Actions`
- `Service_Fabric_Clusters`
- `Shared_Image_Galleries`
- `Stage_Maps`
- `Virtual_Machine`
- `Virtual_Machines_Classic`
- `VM_Images_Classic`
- `VM_Scale_Sets`
- `Workspaces`
- `Workspaces2`

### containers (11)

- `AKS_Network_Policy`
- `App_Services`
- `Azure_Container_Storage`
- `Azure_Red_Hat_OpenShift`
- `Batch_Accounts`
- `Container_Instances`
- `Container_Registries`
- `Kubernetes_Hub`
- `Kubernetes_Services`
- `Service_Fabric_Clusters`
- `Service_Groups`

### cxp (2)

- `Elixir`
- `Elixir_Purple`

### databases (30)

- `Azure_Cosmos_DB`
- `Azure_Data_Explorer_Clusters`
- `Azure_Database_MariaDB_Server`
- `Azure_Database_Migration_Services`
- `Azure_Database_MySQL_Server`
- `Azure_Database_PostgreSQL_Server`
- `Azure_Database_PostgreSQL_Server_Group`
- `Azure_DocumentDB`
- `Azure_Managed_Redis`
- `Azure_Purview_Accounts`
- `Azure_SQL`
- `Azure_SQL_Edge`
- `Azure_SQL_Server_Stretch_Databases`
- `Azure_SQL_VM`
- `Azure_Synapse_Analytics`
- `Cache_Redis`
- `Data_Factory`
- `Elastic_Job_Agents`
- `Instance_Pools`
- `Managed_Database`
- `Oracle_Database`
- `SQL_Data_Warehouses`
- `SQL_Database`
- `SQL_Database_Fleet_Manager`
- `SQL_Elastic_Pools`
- `SQL_Managed_Instance`
- `SQL_Server`
- `SQL_Server_Registries`
- `SSIS_Lift_And_Shift_IR`
- `Virtual_Clusters`

### devops (11)

- `API_Connections`
- `Application_Insights`
- `Azure_App_Testing`
- `Azure_DevOps`
- `Change_Analysis`
- `CloudTest`
- `Code_Optimization`
- `DevOps_Starter`
- `DevTest_Labs`
- `Lab_Accounts`
- `Lab_Services`

### general (99)

- `All_Resources`
- `Backlog`
- `Biz_Talk`
- `Blob_Block`
- `Blob_Page`
- `Branch`
- `Browser`
- `Bug`
- `Builds`
- `Cache`
- `Code`
- `Commit`
- `Controls`
- `Controls_Horizontal`
- `Cost_Alerts`
- `Cost_Analysis`
- `Cost_Budgets`
- `Cost_Management`
- `Cost_Management_and_Billing`
- `Counter`
- `Cubes`
- `Dashboard`
- `Dashboard2`
- `Dev_Console`
- `Download`
- `Error`
- `Extensions`
- `File`
- `Files`
- `Folder_Blank`
- `Folder_Website`
- `Free_Services`
- `FTP`
- `Gear`
- `Globe`
- `Globe_Error`
- `Globe_Success`
- `Globe_Warning`
- `Guide`
- `Heart`
- `Help_and_Support`
- `Image`
- `Information`
- `Input_Output`
- `Journey_Hub`
- `Launch_Portal`
- `Learn`
- `Load_Test`
- `Location`
- `Log_Streaming`
- `Management_Groups`
- `Management_Portal`
- `Marketplace`
- `Media`
- `Media_File`
- `Mobile`
- `Mobile_Engagement`
- `Module`
- `Power`
- `Power_Up`
- `Powershell`
- `Preview`
- `Preview_Features`
- `Process_Explorer`
- `Production_Ready_Database`
- `Quickstart_Center`
- `Recent`
- `Region_Management`
- `Reservations`
- `Resource_Explorer`
- `Resource_Group_List`
- `Resource_Groups`
- `Resource_Linked`
- `Scale`
- `Scheduler`
- `Search`
- `Search_Grid`
- `Server_Farm`
- `Service_Bus`
- `Service_Health`
- `SSD`
- `Storage_Azure_Files`
- `Storage_Container`
- `Storage_Queue`
- `Subscriptions`
- `Table`
- `Tag`
- `Tags`
- `Templates`
- `TFS_VC_Repository`
- `Toolbox`
- `Troubleshoot`
- `Versions`
- `Web_Slots`
- `Web_Test`
- `Website_Power`
- `Website_Staging`
- `Workbooks`
- `Workflow`

### hybrid_multicloud (9)

- `AI_at_Edge`
- `Azure_Local`
- `Azure_Operator_5G_Core`
- `Azure_Operator_Insights`
- `Azure_Operator_Nexus`
- `Azure_Operator_Service_Manager`
- `Azure_Programmable_Connectivity`
- `Edge_Storage_Accelerator`
- `Workload_Orchestration`

### identity (36)

- `AAD_Licenses`
- `Active_Directory_Connect_Health`
- `Active_Directory_Connect_Health2`
- `Administrative_Units`
- `App_Registrations`
- `Azure_Active_Directory`
- `Azure_AD_B2C`
- `Azure_AD_B2C2`
- `Azure_AD_Domain_Services`
- `Azure_AD_Identity_Protection`
- `Azure_AD_Privilege_Identity_Management`
- `Azure_Information_Protection`
- `Custom_Azure_AD_Roles`
- `Enterprise_Applications`
- `Entra_Connect`
- `Entra_Domain_Services`
- `Entra_Global_Secure_Access`
- `Entra_ID_Protection`
- `Entra_Internet_Access`
- `Entra_Managed_Identities`
- `Entra_Private_Access`
- `Entra_Privileged_Identity_Management`
- `Entra_Verified_ID`
- `External_ID`
- `External_Identities`
- `Groups`
- `Identity_Governance`
- `Managed_Identities`
- `Multi_Factor_Authentication`
- `PIM`
- `Security`
- `Tenant_Properties`
- `User_Settings`
- `Users`
- `Verifiable_Credentials`
- `Verification_As_A_Service`

### integration (24)

- `AI_Gateway`
- `API_Management_Services`
- `App_Configuration`
- `Azure_API_for_FHIR`
- `Azure_Data_Catalog`
- `Azure_PubSub`
- `Event_Grid_Domains`
- `Event_Grid_Subscriptions`
- `Event_Grid_Topics`
- `Integration_Accounts`
- `Integration_Environments`
- `Integration_Service_Environments`
- `Logic_Apps`
- `Logic_Apps_Custom_Connector`
- `Logic_Apps_Template`
- `Partner_Namespace`
- `Partner_Registration`
- `Partner_Topic`
- `Relays`
- `SendGrid_Accounts`
- `Service_Bus`
- `Software_as_a_Service`
- `SQL_Data_Warehouses`
- `System_Topic`

### internet_of_things (2)

- `Logic_Apps`
- `Time_Series_Insights_Access_Policies`

### intune (18)

- `Azure_AD_Roles_and_Administrators`
- `Client_Apps`
- `Device_Compliance`
- `Device_Configuration`
- `Device_Enrollment`
- `Device_Security_Apple`
- `Device_Security_Google`
- `Device_Security_Windows`
- `Devices`
- `eBooks`
- `Engage_Center_Connect`
- `Exchange_Access`
- `Intune`
- `Intune_For_Education`
- `Mindaro`
- `Security_Baselines`
- `Software_Updates`
- `Tenant_Status`

### iot (20)

- `Azure_IoT_Operations`
- `Azure_Maps_Accounts`
- `Azure_Stack_HCI_Sizer`
- `Device_Provisioning_Services`
- `Digital_Twins`
- `Event_Hubs`
- `Function_Apps`
- `Hybrid_Connectivity_Hub`
- `Industrial_IoT`
- `IoT_Central_Applications`
- `IoT_Edge`
- `IoT_Hub`
- `Logic_Apps`
- `Notification_Hubs`
- `Stack_HCI_Premium`
- `Stream_Analytics_Jobs`
- `Time_Series_Data_Sets`
- `Time_Series_Insights_Environments`
- `Time_Series_Insights_Event_Sources`
- `Windows10_Core_Services`

### management_governance (34)

- `Activity_Log`
- `Advisor`
- `Alerts`
- `Application_Insights`
- `Arc_Machines`
- `Automation_Accounts`
- `Azure_Arc`
- `Azure_Lighthouse`
- `Blueprints`
- `Compliance`
- `Cost_Management_and_Billing`
- `Customer_Lockbox_for_MS_Azure`
- `Diagnostics_Settings`
- `Education`
- `Landing_Zone`
- `Log_Analytics_Workspaces`
- `MachinesAzureArc`
- `Managed_Applications_Center`
- `Managed_Desktop`
- `Metrics`
- `Monitor`
- `My_Customers`
- `Operation_Log_Classic`
- `Policy`
- `Recovery_Services_Vaults`
- `Resource_Graph_Explorer`
- `Resources_Provider`
- `Scheduler_Job_Collections`
- `Service_Catalog_MAD`
- `Service_Group_Relationships`
- `Service_Providers`
- `solutions`
- `Universal_Print`
- `User_Privacy`

### menu (1)

- `Keys`

### migrate (5)

- `Azure_Migrate`
- `Cost_Management_and_Billing`
- `Data_Box`
- `Data_Box_Edge`
- `Recovery_Services_Vaults`

### mixed_reality (2)

- `Remote_Rendering`
- `Spatial_Anchor_Accounts`

### monitor (1)

- `SAP_Azure_Monitor`

### networking (59)

- `Application_Gateway_Containers`
- `Application_Gateways`
- `ATM_Multistack`
- `Azure_Access_Point`
- `Azure_Communications_Gateway`
- `Azure_Firewall_Manager`
- `Azure_Firewall_Policy`
- `Bastions`
- `CDN_Profiles`
- `Connections`
- `DDoS_Custom_Policy`
- `DDoS_Protection_Plans`
- `DNS_Multistack`
- `DNS_Private_Resolver`
- `DNS_Security_Policy`
- `DNS_Zones`
- `Edge_Actions`
- `ExpressRoute_Circuits`
- `Firewalls`
- `Front_Doors`
- `IP_Address_Manager`
- `IP_Groups`
- `Load_Balancer_Hub`
- `Load_Balancer_Hub2`
- `Load_Balancers`
- `Local_Network_Gateways`
- `NAT`
- `Network_Foundation_Hub`
- `Network_Interfaces`
- `Network_Security_Groups`
- `Network_Security_Hub`
- `Network_Watcher`
- `On_Premises_Data_Gateways`
- `Private_Endpoint`
- `Private_Link`
- `Private_Link_Hub`
- `Private_Link_Service`
- `Proximity_Placement_Groups`
- `Public_IP_Addresses`
- `Public_IP_Addresses_Classic`
- `Public_IP_Prefixes`
- `Reserved_IP_Addresses_Classic`
- `Resource_Management_Private_Link`
- `Route_Filters`
- `Route_Tables`
- `Service_Endpoint_Policies`
- `Spot_VM`
- `Spot_VMSS`
- `Subnet`
- `Traffic_Manager_Profiles`
- `Virtual_Network_Gateways`
- `Virtual_Networks`
- `Virtual_Networks_Classic`
- `Virtual_Router`
- `Virtual_WAN_Hub`
- `Virtual_WANs`
- `VNet_Appliance`
- `VPN_Client_Windows`
- `Web_Application_Firewall_Policies_WAF`

### other (157)

- `ACS_Solutions_Builder`
- `AKS_Automatic`
- `AKS_Istio`
- `API_Proxy`
- `App_Compliance_Automation`
- `App_Space_Component`
- `Aquila`
- `Arc_Data_Services`
- `Arc_Kubernetes`
- `Arc_PostgreSQL`
- `Arc_SQL_Managed_Instance`
- `Arc_SQL_Server`
- `AVS_VM`
- `Azure_A`
- `Azure_Backup_Center`
- `Azure_Center_for_SAP`
- `Azure_Chaos_Studio`
- `Azure_Cloud_Shell`
- `Azure_Communication_Services`
- `Azure_Consumption_Commitment`
- `Azure_Data_Sharing`
- `Azure_Data_Transfer`
- `Azure_Deployment_Environments`
- `Azure_Dev_Tunnels`
- `Azure_Edge_Hardware_Center`
- `Azure_Enclaves`
- `Azure_HPC_Workbench`
- `Azure_Load_Testing`
- `Azure_Monitor_Dashboard`
- `Azure_Monitor_Pipeline`
- `Azure_Network_Function_Manager`
- `Azure_Network_Function_Manager_Functions`
- `Azure_Network_Manager`
- `Azure_Orbital`
- `Azure_Quotas`
- `Azure_Sphere`
- `Azure_Storage_Mover`
- `Azure_Support_Center_Blue`
- `Azure_Sustainability`
- `Azure_Video_Indexer`
- `AzureAttestation`
- `Azurite`
- `Backup_Vault`
- `Bare_Metal_Infrastructure`
- `Breeze`
- `Business_Process_Tracking`
- `Central_Service_Instance_for_SAP`
- `Ceres`
- `Cloud_Services_(extended_support)`
- `Compliance_Center`
- `Compute_Fleet`
- `Confidential_Ledger`
- `Connected_Cache`
- `Connected_Vehicle_Platform`
- `Container_App_Environments`
- `Cost_Export`
- `Custom_IP_Prefix`
- `Dashboard_Hub`
- `Data_Collection_Rules`
- `Database_Instance_for_SAP`
- `Dedicated_HSM`
- `Defender_CM_Local_Manager`
- `Defender_DCS_Controller`
- `Defender_Distributer_Control_System`
- `Defender_Engineering_Station`
- `Defender_External_Management`
- `Defender_Freezer_Monitor`
- `Defender_Historian`
- `Defender_HMI`
- `Defender_Industrial_Packaging_System`
- `Defender_Industrial_Printer`
- `Defender_Industrial_Robot`
- `Defender_Industrial_Scale_System`
- `Defender_Marquee`
- `Defender_Meter`
- `Defender_PLC`
- `Defender_Pneumatic_Device`
- `Defender_Programable_Board`
- `Defender_Relay`
- `Defender_Robot_Controller`
- `Defender_RTU`
- `Defender_Sensor`
- `Defender_Slot`
- `Defender_Web_Guiding_System`
- `Detonation`
- `Device_Update_IoT_Hub`
- `Disconnected_Operations`
- `Disk_Pool`
- `Edge_Management`
- `Elastic_SAN`
- `Entra_Connect_Sync`
- `Entra_Identity`
- `Exchange_On_Premises_Access`
- `Express_Route_Traffic_Collector`
- `ExpressRoute_Direct`
- `FHIR_Service`
- `Fiji`
- `Grafana`
- `HDI_AKS_Cluster`
- `IcM_Troubleshooting`
- `Image_Definition`
- `Image_Version`
- `Instance_Pools`
- `Internet_Analyzer_Profiles`
- `Intune_Trends`
- `Kubernetes_Fleet_Manager`
- `Load_Testing`
- `Local_Network_Gateways`
- `Log_Analytics_Query_Pack`
- `Managed_DevOps_Pools`
- `Managed_File_Shares`
- `Managed_Instance_Apache_Cassandra`
- `Marketplace_Management`
- `MedTech_Service`
- `Microsoft_Discovery`
- `Mission_Landing_Zone`
- `Modular_Data_Center`
- `Monitor_Health_Models`
- `MS_Dev_Box`
- `Network_Security_Perimeters`
- `Open_Supply_Chain_Platform`
- `OSConfig`
- `Peering_Service`
- `Peerings`
- `Private_Endpoints`
- `Private_Mobile_Network`
- `Prometheus`
- `Reserved_Capacity`
- `Reserved_Capacity_Groups`
- `Resiliency`
- `Resource_Guard`
- `Resource_Mover`
- `RTOS`
- `Savings_Plan`
- `SCVMM_Management_Servers`
- `Sonic_Dash`
- `SSH_Keys`
- `Storage_Actions`
- `Storage_Tasks`
- `Targets_Management`
- `Template_Specs`
- `Test_Base`
- `Universal_Print`
- `Update_Center`
- `Video_Analyzers`
- `Virtual_Enclaves`
- `Virtual_Instance_for_SAP`
- `VM_Application_Definition`
- `VM_Application_Version`
- `WAC`
- `WAC_Installer`
- `Web_App_Database`
- `Web_Jobs`
- `Windows_Notification_Services`
- `Windows_Virtual_Desktop`
- `Worker_Container_App`
- `Workspace_Gateway`

### power_platform (9)

- `AIBuilder`
- `CopilotStudio`
- `Dataverse`
- `PowerApps`
- `PowerAutomate`
- `PowerBI`
- `PowerFx`
- `PowerPages`
- `PowerPlatform`

### preview (9)

- `Azure_Cloud_Shell`
- `Azure_Sphere`
- `Azure_Workbooks`
- `IoT_Edge`
- `Private_Link_Hub`
- `RTOS`
- `Static_Apps`
- `Time_Series_Data_Sets`
- `Web_Environment`

### security (14)

- `Application_Security_Groups`
- `Azure_AD_Risky_Signins`
- `Azure_AD_Risky_Users`
- `Azure_Defender`
- `Azure_Sentinel`
- `Conditional_Access`
- `Detonation`
- `ExtendedSecurityUpdates`
- `Identity_Secure_Score`
- `Key_Vaults`
- `Keys`
- `MS_Defender_EASM`
- `Multifactor_Authentication`
- `Security_Center`

### storage (19)

- `Azure_Fileshare`
- `Azure_HCP_Cache`
- `Azure_NetApp_Files`
- `Azure_Stack_Edge`
- `Data_Box`
- `Data_Box_Edge`
- `Data_Lake_Storage_Gen1`
- `Data_Share_Invitations`
- `Data_Shares`
- `Data_Virtualization`
- `Import_Export_Jobs`
- `Recovery_Services_Vaults`
- `Storage_Accounts`
- `Storage_Accounts_Classic`
- `Storage_Explorer`
- `Storage_Hubs`
- `Storage_Sync_Services`
- `StorSimple_Data_Managers`
- `StorSimple_Device_Managers`

### web (6)

- `Agentic_Web_Apps`
- `API_Center`
- `App_Space`
- `Azure_Media_Service`
- `Notification_Hub_Namespaces`
- `SignalR`
