# API Inventory

Living tracker: every frontend page, the API groups it needs, the individual
API names (as named in the frontend's own network-service files), and the
actual backend route once built. Source of the API names/groups is the
frontend team's API audit pasted into the working session — not derived from
this backend.

Update this file whenever a phase lands: fill in **Route** and flip **Status**
to ✅. Do not renumber or delete rows that turn out unneeded — mark them
`⬜ dropped` with a one-line reason instead, so the count stays auditable.

Status legend: ✅ built · ⬜ not built · 🔶 partially built (see note)

---

## Auth: Sign Up

| API Group | API Name       | Route | Status |
| --------- | -------------- | ----- | ------ |
| Sign up   | Create Account | —     | ⬜     |

## Auth: OTP Verification

| API Group | API Name                   | Route | Status |
| --------- | -------------------------- | ----- | ------ |
| OTP       | Send OTP                   | —     | ⬜     |
| OTP       | Resend OTP                 | —     | ⬜     |
| OTP       | Verify OTP                 | —     | ⬜     |
| OTP       | Forgot Password (optional) | —     | ⬜     |

## App init (every page)

| API Group      | API Name                                             | Route              | Status                                                         |
| -------------- | ---------------------------------------------------- | ------------------ | -------------------------------------------------------------- |
| Verify Account | Verify Account (user, permissions, roles, workspace) | `GET /v1/users/me` | 🔶 returns user + roles; not yet permissions/workspace payload |

## Login

| API Group | API Name            | Route                         | Status |
| --------- | ------------------- | ----------------------------- | ------ |
| Login     | Staff Login         | `POST /v1/auth/staff/login`   | ✅     |
| Login     | Partner/Agent Login | `POST /v1/auth/partner/login` | ✅     |
| Login     | Refresh Token       | `POST /v1/auth/refresh`       | ✅     |

## Dashboard

Blocked on frontend — UI + API integration pending. No API list provided yet.

| API Group | API Name | Route | Status |
| --------- | -------- | ----- | ------ |
| Dashboard | TBD      | —     | ⬜     |

## Conversations / Inbox

| API Group     | API Name                    | Route | Status |
| ------------- | --------------------------- | ----- | ------ |
| Chat list     | Chat list + filters         | —     | ⬜     |
| Messages      | Get message                 | —     | ⬜     |
| Messages      | Send message (socket event) | —     | ⬜     |
| Assignment    | Assign agent                | —     | ⬜     |
| Assignment    | Reassign agent              | —     | ⬜     |
| Assignment    | Get agent list              | —     | ⬜     |
| Status        | Change status               | —     | ⬜     |
| Status        | Bulk change status          | —     | ⬜     |
| Labels        | Change label                | —     | ⬜     |
| Notes         | Get notes                   | —     | ⬜     |
| Notes         | Add notes                   | —     | ⬜     |
| History       | Previous conversation       | —     | ⬜     |
| Templates     | Get template                | —     | ⬜     |
| Quick replies | Get quick replies           | —     | ⬜     |

## Settings → Users & Permissions

| API Group   | API Name                                                       | Route                                | Status                                                               |
| ----------- | -------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------- |
| Users       | Get Single User                                                | `GET /v1/users/:id`                  | ✅                                                                   |
| Users       | List Users (pagination + search)                               | `GET /v1/users`                      | ✅                                                                   |
| Users       | Create User                                                    | `POST /v1/users`                     | ✅                                                                   |
| Users       | Update User                                                    | `PATCH /v1/users/:id`                | ✅                                                                   |
| Users       | Delete User                                                    | —                                    | ⬜ (deactivate via `status` on PATCH exists; hard delete not built)  |
| Roles       | List Roles                                                     | `GET /v1/roles`                      | ✅                                                                   |
| Roles       | Create Role                                                    | `POST /v1/roles`                     | ✅                                                                   |
| Roles       | Update Role Label                                              | `PATCH /v1/roles/:id`                | ✅                                                                   |
| Roles       | Delete Role                                                    | `DELETE /v1/roles/:id`               | ✅                                                                   |
| Roles       | Assignable Roles Dropdown                                      | `GET /v1/roles` (reuse)              | 🔶 no lightweight dropdown variant yet                               |
| Permissions | Access-Level Options (dynamic vs hardcoded — decision pending) | `GET /v1/permissions`                | 🔶 flat list built; scope-option decision not made                   |
| Permissions | Get Blank Permission Template                                  | —                                    | ⬜                                                                   |
| Permissions | Get Role Permission Tree                                       | —                                    | ⬜ (current model is flat grants array, not a tree — needs decision) |
| Permissions | Save Role Permission Tree                                      | `PATCH /v1/roles/:id` (grants array) | 🔶 flat grants save works; tree shape not built                      |

## Contacts

| API Group            | API Name                                   | Route              | Status                                                     |
| -------------------- | ------------------------------------------ | ------------------ | ---------------------------------------------------------- |
| List/View/Bulk       | getContactsList                            | `GET /v1/contacts` | 🔶 basic list built; not grid/module-record variants below |
| List/View/Bulk       | getContactsListDataAsPerModuleRecord       | —                  | ⬜                                                         |
| List/View/Bulk       | getContactsSelectData                      | —                  | ⬜                                                         |
| List/View/Bulk       | getContactGridView                         | —                  | ⬜                                                         |
| List/View/Bulk       | ContactGridViewUpdate                      | —                  | ⬜                                                         |
| List/View/Bulk       | GetMoreContacts                            | —                  | ⬜                                                         |
| List/View/Bulk       | deleteKanbanContacts                       | —                  | ⬜                                                         |
| List/View/Bulk       | bulkUpdateContact                          | —                  | ⬜                                                         |
| List/View/Bulk       | getBulkUpdateFields                        | —                  | ⬜                                                         |
| List/View/Bulk       | deleteBulkContact                          | —                  | ⬜                                                         |
| List/View/Bulk       | bulkExport                                 | —                  | ⬜                                                         |
| List/View/Bulk       | GetExportedContacts                        | —                  | ⬜                                                         |
| List/View/Bulk       | DownloadExportedContacts                   | —                  | ⬜                                                         |
| List/View/Bulk       | getContactsTagsList                        | —                  | ⬜                                                         |
| List/View/Bulk       | addTagsList                                | —                  | ⬜                                                         |
| List/View/Bulk       | getAssigneeList                            | —                  | ⬜                                                         |
| List/View/Bulk       | addAssignee                                | —                  | ⬜                                                         |
| List/View/Bulk       | getAddToList                               | —                  | ⬜                                                         |
| List/View/Bulk       | addToList                                  | —                  | ⬜                                                         |
| List/View/Bulk       | getAllContactsViews                        | —                  | ⬜                                                         |
| List/View/Bulk       | createContactView                          | —                  | ⬜                                                         |
| List/View/Bulk       | updateContactView                          | —                  | ⬜                                                         |
| List/View/Bulk       | reOrderContactView                         | —                  | ⬜                                                         |
| List/View/Bulk       | deleteContactView                          | —                  | ⬜                                                         |
| List/View/Bulk       | addContactView                             | —                  | ⬜                                                         |
| List/View/Bulk       | closeContactView                           | —                  | ⬜                                                         |
| Add/Edit Form        | saveContactsSocialMedia                    | —                  | ⬜                                                         |
| Add/Edit Form        | getAddContactsFilds                        | —                  | ⬜                                                         |
| Add/Edit Form        | getEditContactsFilds                       | —                  | ⬜                                                         |
| Add/Edit Form        | getAddContactsDropDown                     | —                  | ⬜                                                         |
| Add/Edit Form        | getContactsDropDownForUndependant          | —                  | ⬜                                                         |
| Add/Edit Form        | getReviewedNotes                           | —                  | ⬜                                                         |
| Contact-linked Tasks | getContectList                             | —                  | ⬜                                                         |
| Contact-linked Tasks | getTaskDetailsOptions                      | —                  | ⬜                                                         |
| Contact-linked Tasks | createTask                                 | —                  | ⬜                                                         |
| Contact-linked Tasks | getAllTask                                 | —                  | ⬜                                                         |
| Contact-linked Tasks | getSingleTask                              | —                  | ⬜                                                         |
| Contact-linked Tasks | updateTask                                 | —                  | ⬜                                                         |
| Contact-linked Tasks | getAllTaskByContactId                      | —                  | ⬜                                                         |
| Contact-linked Tasks | deleteTaskByIds                            | —                  | ⬜                                                         |
| Contact-linked Tasks | deleteOutcomeById                          | —                  | ⬜                                                         |
| Contact-linked Tasks | setOutcome                                 | —                  | ⬜                                                         |
| Misc                 | getLeadsTableColumnNetwork                 | —                  | ⬜                                                         |
| Misc                 | leadsForContactNetwork                     | —                  | ⬜                                                         |
| Misc                 | getMarketingStatusOption                   | —                  | ⬜                                                         |
| Misc                 | getLifeCycleStage                          | —                  | ⬜                                                         |
| Misc                 | getEcommerceContactOrderList               | —                  | ⬜                                                         |
| Misc                 | getBroadcastLimit                          | —                  | ⬜                                                         |
| Dropdown helper      | getContactPropertiesFieldOptions           | —                  | ⬜                                                         |
| Dropdown helper      | getContactPropertiesList                   | —                  | ⬜                                                         |
| Dropdown helper      | getAllVisibleContactPropertiesFieldOptions | —                  | ⬜                                                         |

Create/Update/Get-by-id/Delete for a single contact already exist as
`POST/GET/PATCH/DELETE /v1/contacts[/:id]` (Phase 1 reference slice) — the 51
items above are the list/bulk/view/task/misc layer on top, none of which are
built yet.

## Company

| API Group                     | API Name                                   | Route | Status |
| ----------------------------- | ------------------------------------------ | ----- | ------ |
| List/View/Bulk                | getCompaniesList                           | —     | ⬜     |
| List/View/Bulk                | getCompaniesSelectData                     | —     | ⬜     |
| List/View/Bulk                | getCompanyGridView                         | —     | ⬜     |
| List/View/Bulk                | CompanyGridViewUpdate                      | —     | ⬜     |
| List/View/Bulk                | GetMoreCompanies                           | —     | ⬜     |
| List/View/Bulk                | deleteKanbanCompanies                      | —     | ⬜     |
| List/View/Bulk                | bulkUpdateCompany                          | —     | ⬜     |
| List/View/Bulk                | getBulkUpdateFields                        | —     | ⬜     |
| List/View/Bulk                | deleteBulkCompany                          | —     | ⬜     |
| List/View/Bulk                | bulkExport                                 | —     | ⬜     |
| List/View/Bulk                | GetExportedCompanies                       | —     | ⬜     |
| List/View/Bulk                | DownloadExportedCompanies                  | —     | ⬜     |
| List/View/Bulk                | getCompaniesTagsList                       | —     | ⬜     |
| List/View/Bulk                | addTagsList                                | —     | ⬜     |
| List/View/Bulk                | getAssigneeList                            | —     | ⬜     |
| List/View/Bulk                | addAssignee                                | —     | ⬜     |
| List/View/Bulk                | getAddToList                               | —     | ⬜     |
| List/View/Bulk                | addToList                                  | —     | ⬜     |
| List/View/Bulk                | getAllCompaniesViews                       | —     | ⬜     |
| List/View/Bulk                | createCompanyView                          | —     | ⬜     |
| List/View/Bulk                | updateCompanyView                          | —     | ⬜     |
| List/View/Bulk                | reOrderCompanyView                         | —     | ⬜     |
| List/View/Bulk                | deleteCompanyView                          | —     | ⬜     |
| List/View/Bulk                | addCompanyView                             | —     | ⬜     |
| Detail/Profile                | getCompaniesByID                           | —     | ⬜     |
| Detail/Profile                | editCompaniesByID                          | —     | ⬜     |
| Detail/Profile                | getBasicInfo                               | —     | ⬜     |
| Detail/Profile                | getCommunication                           | —     | ⬜     |
| Detail/Profile                | getSourceDetails                           | —     | ⬜     |
| Detail/Profile                | getMarketingInformation                    | —     | ⬜     |
| Detail/Profile                | getActivities                              | —     | ⬜     |
| Detail/Profile                | getFiles                                   | —     | ⬜     |
| Detail/Profile                | getChatTranscript                          | —     | ⬜     |
| Detail/Profile                | addNoteAsPerId                             | —     | ⬜     |
| Detail/Profile                | getAllNotes                                | —     | ⬜     |
| Detail/Profile                | updateNote                                 | —     | ⬜     |
| Detail/Profile                | deleteNote                                 | —     | ⬜     |
| Detail/Profile                | downloadFile                               | —     | ⬜     |
| Detail/Profile                | deleteFile                                 | —     | ⬜     |
| Detail/Profile                | addFiles                                   | —     | ⬜     |
| Detail/Profile                | getCompaniesTagsListByID                   | —     | ⬜     |
| Detail/Profile                | getSectionDetails                          | —     | ⬜     |
| Detail/Profile                | getSectionFields                           | —     | ⬜     |
| Detail/Profile                | filedHistoryNetwork                        | —     | ⬜     |
| Add/Edit Form + Contacts Link | saveCompaniesSocialMedia                   | —     | ⬜     |
| Add/Edit Form + Contacts Link | getAddCompaniesFilds                       | —     | ⬜     |
| Add/Edit Form + Contacts Link | getEditCompaniesFilds                      | —     | ⬜     |
| Add/Edit Form + Contacts Link | getAddCompaniesDropDown                    | —     | ⬜     |
| Add/Edit Form + Contacts Link | getCompaniesDropDownForUndependant         | —     | ⬜     |
| Add/Edit Form + Contacts Link | getReviewedNotes                           | —     | ⬜     |
| Add/Edit Form + Contacts Link | getCompaniesContactsList                   | —     | ⬜     |
| Add/Edit Form + Contacts Link | addContactsList                            | —     | ⬜     |
| Company-linked Tasks          | getContectList                             | —     | ⬜     |
| Company-linked Tasks          | getTaskDetailsOptions                      | —     | ⬜     |
| Company-linked Tasks          | createTask                                 | —     | ⬜     |
| Company-linked Tasks          | getAllTask                                 | —     | ⬜     |
| Company-linked Tasks          | getSingleTask                              | —     | ⬜     |
| Company-linked Tasks          | updateTask                                 | —     | ⬜     |
| Company-linked Tasks          | getAllTaskByCompanyId                      | —     | ⬜     |
| Company-linked Tasks          | deleteTaskByIds                            | —     | ⬜     |
| Company-linked Tasks          | deleteOutcomeById                          | —     | ⬜     |
| Company-linked Tasks          | setOutcome                                 | —     | ⬜     |
| Misc                          | closeCompanyView                           | —     | ⬜     |
| Misc                          | getcompanyListTableColumnNetwork           | —     | ⬜     |
| Misc                          | companyListForCompanyNetwork               | —     | ⬜     |
| Misc                          | getMarketingStatusOption                   | —     | ⬜     |
| Misc                          | getLifeCycleStage                          | —     | ⬜     |
| Misc                          | getBroadcastLimit                          | —     | ⬜     |
| Dropdown helper               | getCompanyPropertiesFieldOptions           | —     | ⬜     |
| Dropdown helper               | getCompanyPropertiesList                   | —     | ⬜     |
| Dropdown helper               | getAllVisibleCompanyPropertiesFieldOptions | —     | ⬜     |

## Segments

| API Group | API Name                     | Route | Status |
| --------- | ---------------------------- | ----- | ------ |
| Segments  | getAllSegmentListData        | —     | ⬜     |
| Segments  | getSegmentById               | —     | ⬜     |
| Segments  | getAllSegmentConatctListData | —     | ⬜     |
| Segments  | createSegmentData            | —     | ⬜     |
| Segments  | deleteSegmentById            | —     | ⬜     |
| Segments  | editSegment                  | —     | ⬜     |
| Segments  | getAllPredefinedSegments     | —     | ⬜     |

## Marketing List

| API Group      | API Name                        | Route | Status |
| -------------- | ------------------------------- | ----- | ------ |
| Marketing List | postCreateMarketingList         | —     | ⬜     |
| Marketing List | postCreateMarketingListContact  | —     | ⬜     |
| Marketing List | getAllMarketingListings         | —     | ⬜     |
| Marketing List | getMarketingListById            | —     | ⬜     |
| Marketing List | getNewMarketingListById         | —     | ⬜     |
| Marketing List | uploadDocumentFile              | —     | ⬜     |
| Marketing List | updateNewMarketingListData      | —     | ⬜     |
| Marketing List | updateMarketingListData         | —     | ⬜     |
| Marketing List | getFieldsTypeMappingList        | —     | ⬜     |
| Marketing List | deleteMarketingListById         | —     | ⬜     |
| Marketing List | deleteMarketingDeatilsListById  | —     | ⬜     |
| Marketing List | updateSelectedContactItem       | —     | ⬜     |
| Marketing List | getAllBroadcastData             | —     | ⬜     |
| Marketing List | getAllCommunicationLogsData     | —     | ⬜     |
| Marketing List | getCommunicationLogsDownload    | —     | ⬜     |
| Marketing List | getScheduledBroadcastByID       | —     | ⬜     |
| Marketing List | getContactsSelectData           | —     | ⬜     |
| Marketing List | getExportMarketingList          | —     | ⬜     |
| Marketing List | getContactImpotHistory          | —     | ⬜     |
| Marketing List | getCsvImportHistory             | —     | ⬜     |
| Marketing List | getProgressBarData              | —     | ⬜     |
| Marketing List | getImportHistoryFile            | —     | ⬜     |
| Marketing List | createImportIDNetwork           | —     | ⬜     |
| Marketing List | getUserListing                  | —     | ⬜     |
| Marketing List | ImportFormStepOneNetwork        | —     | ⬜     |
| Marketing List | ImportFormStepTwoNetwork        | —     | ⬜     |
| Marketing List | ImportFormStepThreeNetwork      | —     | ⬜     |
| Marketing List | DeleteTempImportContactsObj     | —     | ⬜     |
| Marketing List | generateCommunicationLogsReport | —     | ⬜     |

## Settings → Data Management → Company Properties

| API Group          | API Name                       | Route | Status |
| ------------------ | ------------------------------ | ----- | ------ |
| Company Properties | getListProperties              | —     | ⬜     |
| Company Properties | updateFieldProperties          | —     | ⬜     |
| Company Properties | ChangeOrderFieldProperties     | —     | ⬜     |
| Company Properties | AddCompanyPropertiesSection    | —     | ⬜     |
| Company Properties | DeleteCompanyPropertiesSection | —     | ⬜     |
| Company Properties | UpdateCompanyPropertiesSection | —     | ⬜     |
| Company Properties | AddCompanyPropertiesFields     | —     | ⬜     |
| Company Properties | UpdateCompanyProperties        | —     | ⬜     |
| Company Properties | HideCompanyProperties          | —     | ⬜     |
| Company Properties | DeleteCompanyProperties        | —     | ⬜     |
| Company Properties | GetAllSectionDetails           | —     | ⬜     |
| Company Properties | GetAllOptions                  | —     | ⬜     |
| Company Properties | reorderFieldPosition           | —     | ⬜     |
| Company Properties | GetHiddenField                 | —     | ⬜     |
| Company Properties | UpdateHiddenField              | —     | ⬜     |
| Company Properties | GetDependencyProperties        | —     | ⬜     |
| Company Properties | GetDependencyOptions           | —     | ⬜     |
| Company Properties | CreateDependencyMapping        | —     | ⬜     |
| Company Properties | GetMappingByID                 | —     | ⬜     |
| Company Properties | GetDependencyList              | —     | ⬜     |
| Company Properties | DeleteDependency               | —     | ⬜     |
| Company Properties | DeleteCompanyPropertiesField   | —     | ⬜     |
| Company Properties | changeFieldPosition            | —     | ⬜     |

## Settings → Data Management → Contact Properties

| API Group          | API Name                       | Route | Status |
| ------------------ | ------------------------------ | ----- | ------ |
| Contact Properties | getListProperties              | —     | ⬜     |
| Contact Properties | updateFieldProperties          | —     | ⬜     |
| Contact Properties | ChangeOrderFieldProperties     | —     | ⬜     |
| Contact Properties | AddContactPropertiesSection    | —     | ⬜     |
| Contact Properties | DeleteContactPropertiesSection | —     | ⬜     |
| Contact Properties | UpdateContactPropertiesSection | —     | ⬜     |
| Contact Properties | AddContactPropertiesFields     | —     | ⬜     |
| Contact Properties | UpdateContactProperties        | —     | ⬜     |
| Contact Properties | HideContactProperties          | —     | ⬜     |
| Contact Properties | DeleteContactProperties        | —     | ⬜     |
| Contact Properties | GetAllSectionDetails           | —     | ⬜     |
| Contact Properties | GetAllOptions                  | —     | ⬜     |
| Contact Properties | reorderFieldPosition           | —     | ⬜     |
| Contact Properties | GetHiddenField                 | —     | ⬜     |
| Contact Properties | UpdateHiddenField              | —     | ⬜     |
| Contact Properties | GetDependencyProperties        | —     | ⬜     |
| Contact Properties | GetDependencyOptions           | —     | ⬜     |
| Contact Properties | CreateDependencyMapping        | —     | ⬜     |
| Contact Properties | GetMappingByID                 | —     | ⬜     |
| Contact Properties | GetDependencyList              | —     | ⬜     |
| Contact Properties | DeleteDependency               | —     | ⬜     |
| Contact Properties | DeleteContactPropertiesField   | —     | ⬜     |
| Contact Properties | changeFieldPosition            | —     | ⬜     |
| Contact Properties | syncToSubaccounts              | —     | ⬜     |

## WhatsApp Broadcast

| API Group | API Name                     | Route | Status |
| --------- | ---------------------------- | ----- | ------ |
| WhatsApp  | getWhatsappTemplatesListings | —     | ⬜     |
| WhatsApp  | getTemplateById              | —     | ⬜     |
| WhatsApp  | getBroadcastById             | —     | ⬜     |
| WhatsApp  | getFieldsTypeMappingList     | —     | ⬜     |
| WhatsApp  | getContactListData           | —     | ⬜     |
| WhatsApp  | postDummyContactData         | —     | ⬜     |
| WhatsApp  | updateSelectedContactItem    | —     | ⬜     |
| WhatsApp  | postFilteredData             | —     | ⬜     |
| WhatsApp  | postSelectedListTable        | —     | ⬜     |
| WhatsApp  | getExistingTempData          | —     | ⬜     |
| WhatsApp  | postWhatsappBroadcast        | —     | ⬜     |
| WhatsApp  | updateWhatsappBroadcast      | —     | ⬜     |
| WhatsApp  | postTestWhatsappMessage      | —     | ⬜     |
| WhatsApp  | deleteWhatsappBroadcast      | —     | ⬜     |
| WhatsApp  | sendWhatsappMessage          | —     | ⬜     |
| WhatsApp  | postWhatsappTemplateData     | —     | ⬜     |

## SMS Broadcast

| API Group | API Name                  | Route | Status |
| --------- | ------------------------- | ----- | ------ |
| SMS       | postSelectedListTable     | —     | ⬜     |
| SMS       | getSMSTemplateList        | —     | ⬜     |
| SMS       | getSMSTemplateTag         | —     | ⬜     |
| SMS       | postSmsBroadcast          | —     | ⬜     |
| SMS       | getFieldsTypeMappingList  | —     | ⬜     |
| SMS       | getSMSTemplateUpdateTag   | —     | ⬜     |
| SMS       | getSMSTemplateTagList     | —     | ⬜     |
| SMS       | updateSelectedContactItem | —     | ⬜     |
| SMS       | getTemplateById           | —     | ⬜     |
| SMS       | DeleteTemplateById        | —     | ⬜     |
| SMS       | getSMSAnalyticsList       | —     | ⬜     |
| SMS       | getSMSBroadcastDetailList | —     | ⬜     |
| SMS       | deleteSMSTemplateTags     | —     | ⬜     |
| SMS       | uploadSmsDocumentFile     | —     | ⬜     |
| SMS       | getSMSSenderIDList        | —     | ⬜     |
| SMS       | postSMSBroadcast          | —     | ⬜     |
| SMS       | postTestSMS               | —     | ⬜     |
| SMS       | updateSMSBroadcast        | —     | ⬜     |
| SMS       | getBroadcastById          | —     | ⬜     |
| SMS       | getSMSTemplateCategories  | —     | ⬜     |
| SMS       | uploadSMSTemplate         | —     | ⬜     |
| SMS       | deleteSmsBroadcast        | —     | ⬜     |
| SMS       | sendSmsMessage            | —     | ⬜     |
| SMS       | newSmsCreateBroadcast     | —     | ⬜     |
| SMS       | newSmsScheduleBroadcast   | —     | ⬜     |
| SMS       | createSMSSenderID         | —     | ⬜     |
| SMS       | updateSMSSenderID         | —     | ⬜     |
| SMS       | deleteSMSSenderID         | —     | ⬜     |
| SMS       | approveSMSTemplate        | —     | ⬜     |
| SMS       | updateSMSTemplate         | —     | ⬜     |
| SMS       | deleteSMSTemplate         | —     | ⬜     |

## Email Broadcast

| API Group | API Name                         | Route | Status |
| --------- | -------------------------------- | ----- | ------ |
| Email     | postEmailDomain                  | —     | ⬜     |
| Email     | postFilteredData                 | —     | ⬜     |
| Email     | postEmailDomainVerification      | —     | ⬜     |
| Email     | postEmailDefault                 | —     | ⬜     |
| Email     | deleteDomain                     | —     | ⬜     |
| Email     | postBounceDomain                 | —     | ⬜     |
| Email     | getEmailAnalyticsList            | —     | ⬜     |
| Email     | getEmailAnalyticsListByID        | —     | ⬜     |
| Email     | getEmailTemplatesLists           | —     | ⬜     |
| Email     | getEmailgalleryTemplatesListings | —     | ⬜     |
| Email     | postEmailTemplate                | —     | ⬜     |
| Email     | getEmailTag                      | —     | ⬜     |
| Email     | getEmailTemplateList             | —     | ⬜     |
| Email     | deleteEmailTemplate              | —     | ⬜     |
| Email     | getBroadcastById                 | —     | ⬜     |
| Email     | postCreateBroadcast              | —     | ⬜     |
| Email     | deleteEmailBroadcast             | —     | ⬜     |
| Email     | updateSelectedContactItem        | —     | ⬜     |
| Email     | postUpload                       | —     | ⬜     |
| Email     | getValidateEmail                 | —     | ⬜     |
| Email     | getFieldsTypeMappingList         | —     | ⬜     |
| Email     | getFooterList                    | —     | ⬜     |
| Email     | postSelectedListTable            | —     | ⬜     |
| Email     | updateEmailBroadcast             | —     | ⬜     |
| Email     | updateEmailTemplate              | —     | ⬜     |
| Email     | updateEmailThumbnail             | —     | ⬜     |
| Email     | postTestEmailTemplate            | —     | ⬜     |
| Email     | getContactPropertiesList         | —     | ⬜     |
| Email     | sendEmailMessage                 | —     | ⬜     |
| Email     | postemailBroadcast               | —     | ⬜     |
| Email     | getRefreshedBroadcastStatsData   | —     | ⬜     |

## Automation

Not itemised into individual endpoints by the frontend team — tracked as 9
workstreams, one of which (node configuration forms) alone implies ~30 more
endpoints once broken out.

| API Group  | API Name                                           | Route | Status |
| ---------- | -------------------------------------------------- | ----- | ------ |
| Automation | CRUD & List                                        | —     | ⬜     |
| Automation | Publish / Unpublish Lifecycle                      | —     | ⬜     |
| Automation | Folder Management                                  | —     | ⬜     |
| Automation | Builder Metadata & Node Configuration Persistence  | —     | ⬜     |
| Automation | Google Sheets OAuth & Data Flow                    | —     | ⬜     |
| Automation | WhatsApp Conversion API (WABA)                     | —     | ⬜     |
| Automation | Auto-Assignment Rules                              | —     | ⬜     |
| Automation | Node Configuration Forms (30 forms — not itemised) | —     | ⬜     |
| Automation | Cross-Module Dependencies (wiring/reuse)           | —     | ⬜     |

## Deals

| API Group         | API Name          | Route | Status |
| ----------------- | ----------------- | ----- | ------ |
| Pipeline & Stages | createPipeline    | —     | ⬜     |
| Pipeline & Stages | getAllPipelines   | —     | ⬜     |
| Pipeline & Stages | updatePipeline    | —     | ⬜     |
| Pipeline & Stages | deletePipeline    | —     | ⬜     |
| Pipeline & Stages | deleteStage       | —     | ⬜     |
| Lost Reasons      | createLostReason  | —     | ⬜     |
| Lost Reasons      | getLostReasons    | —     | ⬜     |
| Lost Reasons      | setLostReasons    | —     | ⬜     |
| Lost Reasons      | DeleteLostReasons | —     | ⬜     |
| Deals CRUD + Form | getDealForm       | —     | ⬜     |
| Deals CRUD + Form | getDealList       | —     | ⬜     |
| Deals CRUD + Form | createDeal        | —     | ⬜     |
| Deals CRUD + Form | getDealById       | —     | ⬜     |
| Deals CRUD + Form | updateDealById    | —     | ⬜     |
| Deals CRUD + Form | deleteDeal        | —     | ⬜     |
| Deals CRUD + Form | createDealNote    | —     | ⬜     |

## Tasks (contact/company-linked)

| API Group | API Name                                      | Route | Status |
| --------- | --------------------------------------------- | ----- | ------ |
| Tasks     | getTaskDetailsOptions                         | —     | ⬜     |
| Tasks     | createTask                                    | —     | ⬜     |
| Tasks     | getAllTask                                    | —     | ⬜     |
| Tasks     | getSingleTask                                 | —     | ⬜     |
| Tasks     | updateTask                                    | —     | ⬜     |
| Tasks     | getAllTaskByContactId / getAllTaskByCompanyId | —     | ⬜     |
| Tasks     | deleteTaskByIds                               | —     | ⬜     |
| Tasks     | deleteOutcomeById                             | —     | ⬜     |
| Tasks     | setOutcome                                    | —     | ⬜     |

## Forms

| API Group                      | API Name                                    | Route | Status |
| ------------------------------ | ------------------------------------------- | ----- | ------ |
| Form Builder                   | createForm                                  | —     | ⬜     |
| Form Builder                   | getForm                                     | —     | ⬜     |
| Form Builder                   | updateForm                                  | —     | ⬜     |
| Form Builder                   | getFormsListing                             | —     | ⬜     |
| Form Builder                   | deleteForm                                  | —     | ⬜     |
| Form Builder                   | getAddContactsDropDown                      | —     | ⬜     |
| Application Form / Submissions | getApplicationFormsList                     | —     | ⬜     |
| Application Form / Submissions | getFormProperties                           | —     | ⬜     |
| Application Form / Submissions | getApplicationFieldsMapping                 | —     | ⬜     |
| Application Form / Submissions | getAttachmentNetwork                        | —     | ⬜     |
| Application Form / Submissions | markPaymentOfflineNetwork                   | —     | ⬜     |
| Application Form / Submissions | getPaymentDetailsNetwork                    | —     | ⬜     |
| Application Form / Submissions | changeStatusToDraftNetwork                  | —     | ⬜     |
| Application Form / Submissions | markAsReviewedNetwork                       | —     | ⬜     |
| Application Form / Submissions | markedAsNotReviewedNetwork                  | —     | ⬜     |
| Application Form / Submissions | updateAttachmentStatusNetwork               | —     | ⬜     |
| Application Form / Submissions | getApplicationFormPdf                       | —     | ⬜     |
| Application Form / Submissions | bulkApplicationsExport                      | —     | ⬜     |
| Application Form / Submissions | getApplicationPropertyOptions               | —     | ⬜     |
| Application Form / Submissions | getApplicationPropertyOptionsWithDependency | —     | ⬜     |

## Api Library

| API Group   | API Name                       | Route | Status |
| ----------- | ------------------------------ | ----- | ------ |
| Api Library | getApiList                     | —     | ⬜     |
| Api Library | CreateApi                      | —     | ⬜     |
| Api Library | GetApiDetails                  | —     | ⬜     |
| Api Library | EditApi                        | —     | ⬜     |
| Api Library | DeleteApi                      | —     | ⬜     |
| Api Library | RunTestAPI                     | —     | ⬜     |
| Api Library | getApiListOption               | —     | ⬜     |
| Api Library | getApiLibraryLogsList          | —     | ⬜     |
| Api Library | fetchApiLogs                   | —     | ⬜     |
| Api Library | API Logs Endpoint (additional) | —     | ⬜     |

## Webhook

| API Group        | API Name               | Route | Status |
| ---------------- | ---------------------- | ----- | ------ |
| Outbound Webhook | getWebhookList         | —     | ⬜     |
| Outbound Webhook | CreateWebhook          | —     | ⬜     |
| Outbound Webhook | GetWebhookDetails      | —     | ⬜     |
| Outbound Webhook | EditWebhook            | —     | ⬜     |
| Outbound Webhook | DeleteWebhook          | —     | ⬜     |
| Outbound Webhook | RunTestWebhook         | —     | ⬜     |
| Outbound Webhook | getContactProperties   | —     | ⬜     |
| Inbound Webhook  | getWebhookNetwork      | —     | ⬜     |
| Inbound Webhook  | generateWebhookNetwork | —     | ⬜     |

## File Manager

| API Group    | API Name           | Route | Status |
| ------------ | ------------------ | ----- | ------ |
| File Manager | getFolderListing   | —     | ⬜     |
| File Manager | createfolder       | —     | ⬜     |
| File Manager | renameboard        | —     | ⬜     |
| File Manager | deleteFolderaction | —     | ⬜     |
| File Manager | GetFiles           | —     | ⬜     |
| File Manager | DeleteFile         | —     | ⬜     |
| File Manager | MoveFile           | —     | ⬜     |
| File Manager | uploadFiles        | —     | ⬜     |
| File Manager | DownloadFile       | —     | ⬜     |

## Subscription

| API Group                   | API Name                       | Route | Status |
| --------------------------- | ------------------------------ | ----- | ------ |
| subscriptionsNetworkService | getAllPlans                    | —     | ⬜     |
| subscriptionsNetworkService | getSubscriptionData            | —     | ⬜     |
| subscriptionsNetworkService | getAddonListData               | —     | ⬜     |
| subscriptionsNetworkService | updateSubscriptionData         | —     | ⬜     |
| subscriptionsNetworkService | getAllInvoiceList              | —     | ⬜     |
| subscriptionsNetworkService | updateSubscriptionCallbackData | —     | ⬜     |
| subscriptionsNetworkService | cancleSubscripation            | —     | ⬜     |
| subscriptionsNetworkService | successSubscripation           | —     | ⬜     |
| subscriptionsNetworkService | addCredits                     | —     | ⬜     |
| subscriptionsNetworkService | getInvoiceByID                 | —     | ⬜     |
| subscriptionsNetworkService | getInvoiceCount                | —     | ⬜     |
| subscriptionsNetworkService | freePlanSuccessCallback        | —     | ⬜     |
| subscriptionsNetworkService | getAllCountryList              | —     | ⬜     |
| subscriptionsNetworkService | getCreditListById              | —     | ⬜     |
| subscriptionsNetworkService | getAllWalletInvoiceList        | —     | ⬜     |
| subscriptionsNetworkService | getWalletInvoiceCount          | —     | ⬜     |
| subscriptionsNetworkService | getInvoicePaymentLink          | —     | ⬜     |
| subscriptionsNetworkService | getCreditUtilization           | —     | ⬜     |
| subscriptionsNetworkService | getwhatsappCreditLogsData      | —     | ⬜     |
| subscriptionsNetworkService | getCreditSummaryLogsNetwork    | —     | ⬜     |
| subscriptionsNetworkService | getCreditSummaryNetwork        | —     | ⬜     |
| subscriptionsNetworkService | GetAITemplateLogs              | —     | ⬜     |
| subscriptionsNetworkService | GetSmartAILogs                 | —     | ⬜     |
| subscriptionsNetworkService | GetConversationLogs            | —     | ⬜     |
| CoreService (subscription)  | getPlans                       | —     | ⬜     |
| CoreService (subscription)  | getCredits                     | —     | ⬜     |
| CoreService (subscription)  | startSubscription              | —     | ⬜     |
| CoreService (subscription)  | upgradeSubscription            | —     | ⬜     |
| CoreService (subscription)  | finalizeSubscription           | —     | ⬜     |
| CoreService (subscription)  | getActiveSubscriptions         | —     | ⬜     |

## URL Tracking

| API Group            | API Name                 | Route | Status |
| -------------------- | ------------------------ | ----- | ------ |
| UTM Links            | listUtmLinks             | —     | ⬜     |
| UTM Links            | createUtmLink            | —     | ⬜     |
| UTM Links            | updateUtmLink            | —     | ⬜     |
| UTM Links            | deleteUtmLink            | —     | ⬜     |
| Sources              | listSources              | —     | ⬜     |
| Sources              | createSource             | —     | ⬜     |
| Sources              | updateSource             | —     | ⬜     |
| Sources              | deleteSource             | —     | ⬜     |
| Mediums              | listMediums              | —     | ⬜     |
| Mediums              | createMedium             | —     | ⬜     |
| Mediums              | updateMedium             | —     | ⬜     |
| Mediums              | deleteMedium             | —     | ⬜     |
| UTM Builder Settings | getUtmBuilderSettings    | —     | ⬜     |
| UTM Builder Settings | updateUtmBuilderSettings | —     | ⬜     |

## App Store

| API Group                  | API Name                            | Route | Status |
| -------------------------- | ----------------------------------- | ----- | ------ |
| Marketplace                | getAvailableApps                    | —     | ⬜     |
| Marketplace                | getInstalledApps                    | —     | ⬜     |
| Marketplace                | getAppDetails                       | —     | ⬜     |
| OpenAI Key Management      | getOpenAiKeyStatus                  | —     | ⬜     |
| OpenAI Key Management      | saveOrUpdateOpenAiKey               | —     | ⬜     |
| OpenAI Key Management      | deleteOpenAiKey                     | —     | ⬜     |
| OpenAI Key Management      | getAIModelPrice                     | —     | ⬜     |
| Shopify/WooCommerce        | postConnectWoocommerceApp           | —     | ⬜     |
| Shopify/WooCommerce        | postConnectShopifyApp               | —     | ⬜     |
| Shopify/WooCommerce        | postConnectShopifyAppManually       | —     | ⬜     |
| Facebook Lead Forms        | getFacebookAccountDeatils           | —     | ⬜     |
| Facebook Lead Forms        | getFacebookConnectedPageList        | —     | ⬜     |
| Facebook Lead Forms        | getSyncStatus                       | —     | ⬜     |
| Facebook Lead Forms        | getSyncPastList                     | —     | ⬜     |
| Facebook Lead Forms        | refreshFacebookLeadPage             | —     | ⬜     |
| Facebook Lead Forms        | disconnectFacebook                  | —     | ⬜     |
| Facebook Lead Forms        | getFacebookConnectedPageFormList    | —     | ⬜     |
| Facebook Lead Forms        | refreshFacebookLeadForms            | —     | ⬜     |
| Facebook Lead Forms        | enableDisableFacebookLeadForms      | —     | ⬜     |
| Facebook Lead Forms        | enableDisableSingleFacebookLeadForm | —     | ⬜     |
| Facebook Lead Forms        | getFormDetails                      | —     | ⬜     |
| Facebook Lead Forms        | setMappingFields                    | —     | ⬜     |
| Integration Logs           | fetchIntegrationLogs                | —     | ⬜     |
| Zoho CRM                   | getZohoOauthRedirectUrl             | —     | ⬜     |
| Zoho CRM                   | getZohoFieldsMapping                | —     | ⬜     |
| Zoho CRM                   | getZohoFieldsData                   | —     | ⬜     |
| Zoho CRM                   | updateZohoFieldsMapping             | —     | ⬜     |
| Zoho CRM                   | saveZohoConfiguration               | —     | ⬜     |
| Zoho CRM                   | logoutZohoConfiguration             | —     | ⬜     |
| Google Sheets              | getGoogleSheetOauthRedirectUrl      | —     | ⬜     |
| Google Sheets              | saveGoogleSheetConfiguration        | —     | ⬜     |
| Google Sheets              | getcreatedGoogleSheet               | —     | ⬜     |
| Google Sheets              | logoutGoogleConfiguration           | —     | ⬜     |
| Facebook Channel           | getAllBots                          | —     | ⬜     |
| Facebook Channel           | saveFacbookConfig                   | —     | ⬜     |
| Facebook Channel           | unassignFacbookConfig               | —     | ⬜     |
| Facebook Channel           | getFacebookPageConfig               | —     | ⬜     |
| Facebook Channel Settings  | add-config                          | —     | ⬜     |
| Facebook Channel Settings  | get-config-data                     | —     | ⬜     |
| Facebook Channel Settings  | logout                              | —     | ⬜     |
| Facebook Channel Settings  | disconnect-page                     | —     | ⬜     |
| Facebook Channel Settings  | catalog-OAuth-callback              | —     | ⬜     |
| Instagram Channel Settings | add-config                          | —     | ⬜     |
| Instagram Channel Settings | get-config-data                     | —     | ⬜     |
| Instagram Channel Settings | logout                              | —     | ⬜     |
| Instagram Channel Settings | disconnect-page                     | —     | ⬜     |

## WhatsApp Flow

| API Group     | API Name                    | Route | Status |
| ------------- | --------------------------- | ----- | ------ |
| WhatsApp Flow | getDefaultFlowAndCategories | —     | ⬜     |
| WhatsApp Flow | createFlow                  | —     | ⬜     |
| WhatsApp Flow | updateFlow                  | —     | ⬜     |
| WhatsApp Flow | getFlows                    | —     | ⬜     |
| WhatsApp Flow | deleteFlow                  | —     | ⬜     |
| WhatsApp Flow | cloneFlow                   | —     | ⬜     |
| WhatsApp Flow | deprecateFlow               | —     | ⬜     |
| WhatsApp Flow | publishFlow                 | —     | ⬜     |
| WhatsApp Flow | syncFlow                    | —     | ⬜     |
| WhatsApp Flow | getWhastappConfig           | —     | ⬜     |
| WhatsApp Flow | getDropDownValue            | —     | ⬜     |

## Settings (remaining sub-pages — excludes Users/Roles/Contact Properties/Company Properties/Deals-Pipeline, already tracked above)

| API Group                                | API Name                       | Route | Status |
| ---------------------------------------- | ------------------------------ | ----- | ------ |
| Notifications                            | getNotificationConfig          | —     | ⬜     |
| Notifications                            | updateNotificationConfig       | —     | ⬜     |
| QR Logs                                  | scanQrLogs                     | —     | ⬜     |
| Import History                           | getImportHistory               | —     | ⬜     |
| Import History                           | getCsvBroadcastImports         | —     | ⬜     |
| Import History                           | downloadFile                   | —     | ⬜     |
| Export Contact History                   | getExportHistory               | —     | ⬜     |
| Export Contact History                   | exportDataById                 | —     | ⬜     |
| Lifecycle Stage                          | getStructure                   | —     | ⬜     |
| Lifecycle Stage                          | getLifecycleStage              | —     | ⬜     |
| Lifecycle Stage                          | changeLifecycleState           | —     | ⬜     |
| Lifecycle Stage                          | createLifecycleStage           | —     | ⬜     |
| Lifecycle Stage                          | updateLifecycleStage           | —     | ⬜     |
| Lifecycle Stage                          | deleteLifecycleStage           | —     | ⬜     |
| Lifecycle Stage                          | changeLifecyclePosition        | —     | ⬜     |
| Task Outcome                             | getTaskOutcomeOptions          | —     | ⬜     |
| Task Outcome                             | deleteTaskOutcome              | —     | ⬜     |
| Task Outcome                             | setOutcome                     | —     | ⬜     |
| Sync Contact Properties                  | Sync to Sub Accounts           | —     | ⬜     |
| Auto-Assignment Rules                    | Create Assignment Rule         | —     | ⬜     |
| Auto-Assignment Rules                    | List Assignment Rules          | —     | ⬜     |
| Auto-Assignment Rules                    | Get Assignment Rule By ID      | —     | ⬜     |
| Auto-Assignment Rules                    | Update Assignment Rule         | —     | ⬜     |
| Auto-Assignment Rules                    | Delete Assignment Rule         | —     | ⬜     |
| Assignment + Business Hours + Inactivity | Get Workspace Configuration    | —     | ⬜     |
| Assignment + Business Hours + Inactivity | Update Workspace Configuration | —     | ⬜     |
| Chat Labels                              | Create Chat Label              | —     | ⬜     |
| Chat Labels                              | Get Chat Labels                | —     | ⬜     |
| Chat Labels                              | Update Chat Label              | —     | ⬜     |
| Chat Labels                              | Get Chat Label By ID           | —     | ⬜     |
| Chat Labels                              | Delete Chat Label              | —     | ⬜     |
| Canned Responses                         | Create Canned Response         | —     | ⬜     |
| Canned Responses                         | Get Canned Responses           | —     | ⬜     |
| Canned Responses                         | Get Canned Response By ID      | —     | ⬜     |
| Canned Responses                         | Update Canned Response         | —     | ⬜     |
| Canned Responses                         | Delete Canned Response         | —     | ⬜     |
| Canned Responses                         | Search Canned Responses        | —     | ⬜     |
| Opt-in Management                        | Get User Consent               | —     | ⬜     |
| Opt-in Management                        | Update User Consent            | —     | ⬜     |
| Channels – Email                         | Create Sub Account             | —     | ⬜     |
| Channels – Email                         | Get Valid Email List           | —     | ⬜     |
| Channels – Email                         | Update Email Profile           | —     | ⬜     |
| Channels – Email                         | Get Domain List                | —     | ⬜     |
| Channels – Email                         | Add Valid Email                | —     | ⬜     |
| Channels – Email                         | Delete Valid Email             | —     | ⬜     |
| Channels – Email                         | Add Domain                     | —     | ⬜     |
| Channels – Email                         | Verify Domain                  | —     | ⬜     |
| Channels – Email                         | Add Bounce Domain              | —     | ⬜     |
| Channels – Email                         | Set Default Domain             | —     | ⬜     |
| Channels – Email                         | Delete Domain                  | —     | ⬜     |
| Channels – Email                         | Get Email Profiles             | —     | ⬜     |
| Channels – Email                         | Update Domain Configuration    | —     | ⬜     |
| Channels – Instagram                     | Instagram Integrations         | —     | ⬜     |
| Channels – Instagram                     | Get Instagram Configuration    | —     | ⬜     |
| Channels – Instagram                     | Instagram Logout               | —     | ⬜     |
| Channels – Instagram                     | Delete Instagram Page          | —     | ⬜     |
| Channels – Facebook                      | Facebook Lead Form Callback    | —     | ⬜     |
| Channels – Facebook                      | Facebook Catalogue Callback    | —     | ⬜     |
| Channels – Facebook                      | Get Facebook Configuration     | —     | ⬜     |
| Channels – Facebook                      | Facebook Logout                | —     | ⬜     |
| Channels – Facebook                      | Delete Facebook Page           | —     | ⬜     |
| Channels – Facebook                      | Get Chatbot List               | —     | ⬜     |
| Channels – Facebook                      | Assign Page To Bot             | —     | ⬜     |
| Channels – Facebook                      | Unassign Page From Bot         | —     | ⬜     |
| Channels – Facebook                      | Get Connected Chatbot          | —     | ⬜     |
| Channels – WhatsApp                      | WhatsApp Authentication        | —     | ⬜     |
| Channels – WhatsApp                      | Pinnacle Callback              | —     | ⬜     |
| Channels – WhatsApp                      | Get WhatsApp Configuration     | —     | ⬜     |
| Channels – WhatsApp                      | Update User Consent            | —     | ⬜     |
| AI Service Settings                      | Get Model Pricing              | —     | ⬜     |
| AI Service Settings                      | Save Model Pricing             | —     | ⬜     |
| AI Service Settings                      | Get AI Providers               | —     | ⬜     |
| AI Service Settings                      | Get API Key                    | —     | ⬜     |
| AI Service Settings                      | Save API Key                   | —     | ⬜     |
| AI Service Settings                      | Delete API Key                 | —     | ⬜     |
| AI Service Settings                      | OpenRouter Configuration       | —     | ⬜     |
| Manage Account – Webhook                 | Get Webhook Configuration      | —     | ⬜     |
| Manage Account – Webhook                 | Save Webhook Configuration     | —     | ⬜     |
| Manage Account – API Keys                | Get API Key                    | —     | ⬜     |
| Manage Account – API Keys                | Regenerate API Key             | —     | ⬜     |
| Manage Account – Sub Accounts            | Get Sub Accounts               | —     | ⬜     |
| Manage Account – Sub Accounts            | Get Credit Information         | —     | ⬜     |
| Manage Account – Sub Accounts            | Update Account Status          | —     | ⬜     |
| Manage Account – Sub Accounts            | Add Credits                    | —     | ⬜     |
| Manage Account – Sub Accounts            | Remove Credits                 | —     | ⬜     |
| Manage Account – Sub Accounts            | Get Rates                      | —     | ⬜     |
| Manage Account – Sub Accounts            | Update Rates                   | —     | ⬜     |
| Manage Account – Sub Accounts            | Upgrade Plan                   | —     | ⬜     |
| Manage Account – Sub Accounts            | Disable Subscription           | —     | ⬜     |
| Manage Account – Sub Accounts            | Get Plans                      | —     | ⬜     |
| Manage Account – Transaction Logs        | Get Credit Sharing Logs        | —     | ⬜     |
| Manage Account – Own Transaction Logs    | Get Own Credit Sharing Logs    | —     | ⬜     |

---

## Summary

| Page/Module               | APIs (deduped)                        | Built                        |
| ------------------------- | ------------------------------------- | ---------------------------- |
| Sign Up                   | 1                                     | 0                            |
| OTP                       | 4                                     | 0                            |
| Verify Account (app init) | 1                                     | 1 🔶                         |
| Login                     | 3                                     | 3                            |
| Dashboard                 | TBD                                   | —                            |
| Conversations/Inbox       | 14                                    | 0                            |
| Users & Permissions       | 14                                    | 10 🔶                        |
| Contacts                  | 51                                    | 5 (base CRUD only, see note) |
| Company                   | 71                                    | 0                            |
| Segments                  | 7                                     | 0                            |
| Marketing List            | 29                                    | 0                            |
| Company Properties        | 23                                    | 0                            |
| Contact Properties        | 24                                    | 0                            |
| WhatsApp Broadcast        | 16                                    | 0                            |
| SMS Broadcast             | 31                                    | 0                            |
| Email Broadcast           | 31                                    | 0                            |
| Automation                | TBD (9 workstreams)                   | 0                            |
| Deals                     | 16                                    | 0                            |
| Tasks                     | 9                                     | 0                            |
| Forms                     | 20                                    | 0                            |
| Api Library               | 10                                    | 0                            |
| Webhook                   | 9                                     | 0                            |
| File Manager              | 9                                     | 0                            |
| Subscription              | 30                                    | 0                            |
| URL Tracking              | 14                                    | 0                            |
| App Store                 | 44                                    | 0                            |
| WhatsApp Flow             | 11                                    | 0                            |
| Settings (remaining)      | 92                                    | 0                            |
| **Total**                 | **~582** (+ Dashboard/Automation TBD) | **~14**                      |

Base contact CRUD (`GET/POST/PATCH/DELETE /v1/contacts[/:id]`) is built as the
reference slice per [contacts.controller.ts](../apps/api/src/modules/crm/contacts/contacts.controller.ts)
— counted once above, not against each of the 51 Contacts-page line items,
since those are a different (list/bulk/view) layer on top of it.
