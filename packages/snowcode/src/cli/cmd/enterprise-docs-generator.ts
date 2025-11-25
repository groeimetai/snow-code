/**
 * Enterprise Documentation Generator
 *
 * Generates comprehensive enterprise workflow instructions for AGENTS.md and CLAUDE.md
 * when user authenticates with Snow-Flow Enterprise (Jira, Azure DevOps, Confluence).
 *
 * This is a copy of snow-flow/src/cli/enterprise-docs-generator.ts to avoid cross-project dependencies.
 */

/**
 * Generate comprehensive enterprise workflow instructions
 * This function is called by updateDocumentationWithEnterprise() in auth.ts
 */
export function generateEnterpriseInstructions(enabledServices: string[]): string {
  const hasJira = enabledServices.includes('jira');
  const hasAzdo = enabledServices.includes('azdo');
  const hasConfluence = enabledServices.includes('confluence');

  let instructions = `\n\n---\n\n# 🚀 ENTERPRISE INTEGRATIONS - AUTONOMOUS DEVELOPMENT WORKFLOW\n\n`;
  instructions += `**YOU HAVE ACCESS TO ENTERPRISE TOOLS:** ${enabledServices.map(s => s.toUpperCase()).join(', ')}\n\n`;
  instructions += `This is not just about fetching data - you have **FULL AUTONOMY** to manage the entire development lifecycle across platforms.\n\n`;

  // Add Jira instructions
  if (hasJira) {
    instructions += generateJiraInstructions();
  }

  // Add Azure DevOps instructions
  if (hasAzdo) {
    instructions += generateAzureDevOpsInstructions();
  }

  // Add Confluence instructions
  if (hasConfluence) {
    instructions += generateConfluenceInstructions();
  }

  // Add cross-platform workflow
  if (enabledServices.length > 1) {
    instructions += generateCrossPlatformWorkflow(hasJira, hasAzdo, hasConfluence);
  }

  return instructions;
}

function generateJiraInstructions(): string {
  return `## 🎯 JIRA - AUTONOMOUS STORY MANAGEMENT

### YOUR ROLE: AUTONOMOUS AGILE DEVELOPER

You are a **FULL-STACK AUTONOMOUS DEVELOPER** with complete control over the Jira development lifecycle. You select stories, implement features, document work, manage blockers, and coordinate with teams through Jira—exactly like a human developer.

---

## 📚 AGILE/SCRUM ESSENTIALS

### Key Concepts
- **Sprint**: Time-boxed period (1-4 weeks) for delivering working software
- **Backlog**: Prioritized list of work items
- **Story Points**: Abstract measure of complexity/effort
- **Acceptance Criteria (AC)**: Specific requirements for story completion
- **Definition of Done (DoD)**: Criteria that must be met for a story to be "Done"

### Story Lifecycle States

| State | When to Use | Your Action |
|-------|-------------|-------------|
| **Backlog** | Story not yet ready | Don't start |
| **Ready for Development** | Refined, estimated, approved | **START HERE** |
| **In Progress** | Actively developing | Set when you begin coding |
| **In Review** | Code complete, awaiting review | Move after development done |
| **In Testing** | Being tested by QA | Move after review approved |
| **Blocked** | Waiting on external dependency | Set when blocked |
| **Done** | All AC met, tested, documented | Final state when complete |

**Critical:** Never skip states (In Progress → Done). Always include a comment explaining state transitions.

---

## 🎯 AUTONOMOUS WORKFLOW

### PHASE 1: STORY SELECTION & VALIDATION

**1.1 Find Work (JQL Queries)**
\`\`\`javascript
// Current sprint stories
const stories = await jira_search_issues({
  jql: "project = PROJ AND sprint in openSprints() AND status = 'Ready for Development' ORDER BY priority DESC"
});

// High-priority backlog
const urgent = await jira_search_issues({
  jql: "project = PROJ AND status = 'Ready for Development' AND priority in (Highest, High)"
});
\`\`\`

**1.2 Pre-Flight Validation**
\`\`\`javascript
const story = await jira_get_issue({
  issueKey: "PROJ-123",
  expand: ["renderedFields", "comments", "issuelinks"]
});

// CRITICAL CHECKS before starting
const validationChecks = {
  hasAcceptanceCriteria: story.fields.customfield_10500 || story.fields.description.includes('Acceptance Criteria'),
  hasDescription: story.fields.description && story.fields.description.length > 10,
  isNotBlocked: !story.fields.issuelinks.some(link => link.type.name === "Blocked by"),
  noDependencies: !story.fields.issuelinks.some(link =>
    link.type.name === "Depends on" && link.outwardIssue?.fields.status.name !== "Done"
  ),
  isEstimated: story.fields.customfield_10016 != null
};

const canStart = Object.values(validationChecks).every(check => check === true);

if (!canStart) {
  await jira_add_comment({
    issueKey: "PROJ-123",
    comment: \`⚠️ Cannot start - pre-flight check failed:\\n\${
      Object.entries(validationChecks)
        .filter(([k,v]) => !v)
        .map(([k]) => \`- \${k}\`)
        .join('\\n')
    }\`
  });
  return; // Find different story
}
\`\`\`

**1.3 Claim the Story**
\`\`\`javascript
// Get current user's accountId
const currentUser = await jira_get_current_user();

// Assign + transition + comment in ONE call
await jira_transition_issue({
  issueKey: "PROJ-123",
  transitionIdOrName: "In Progress",
  fields: {
    assignee: { accountId: currentUser.accountId },
    comment: \`🚀 Starting development

Pre-flight: ✅ Passed
Next: Create Update Set → Implement → Test → Document\`
  }
});
\`\`\`

---

### PHASE 2: DEVELOPMENT (WITH REAL-TIME UPDATES!)

**🚨 CRITICAL RULE: Update Jira AS YOU WORK (not at the end!)**

**2.1 Create Update Set FIRST**
\`\`\`javascript
const instanceInfo = await snow_get_instance_info();
const updateSet = await snow_update_set_manage({
  action: 'create',
  name: \`Feature: \${story.fields.summary}\`,
  description: \`Jira: PROJ-123\\nAC: \${acceptanceCriteria.length} criteria\\nComponents: [list]\`
});

// IMMEDIATELY document in Jira
await jira_add_comment({
  issueKey: "PROJ-123",
  comment: \`🔧 Update Set Created\\n**Name:** \${updateSet.name}\\n**Sys ID:** \${updateSet.sys_id}\\n**Link:** \${instanceInfo.data.instance_url}/sys_update_set.do?sys_id=\${updateSet.sys_id}\`
});
\`\`\`

**2.2 Implement + Update After EACH Component**
\`\`\`javascript
// After creating EACH artifact, immediately comment
const artifact = await snow_create_business_rule({ /* config */ });

await jira_add_comment({
  issueKey: "PROJ-123",
  comment: \`✅ Component Complete: \${artifact.name}\\n**Sys ID:** \${artifact.sys_id}\\n**Link:** \${instanceInfo.data.instance_url}/sys_script.do?sys_id=\${artifact.sys_id}\\n**AC Addressed:** AC #1, AC #2\\n**Next:** [Next component]\`
});

// Log time spent
await jira_add_worklog({
  issueKey: "PROJ-123",
  timeSpent: "2h",
  comment: "Implemented Business Rule for auto-assignment"
});
\`\`\`

---

### PHASE 3: TESTING & COMPLETION

**3.1 Test Each Acceptance Criterion**
\`\`\`javascript
const testResults = [];

for (const ac of acceptanceCriteria) {
  // Create test data + verify behavior
  const passed = /* test logic */;
  testResults.push({ criterion: ac.requirement, result: passed ? 'PASS' : 'FAIL' });
}

// Document test results
await jira_add_comment({
  issueKey: "PROJ-123",
  comment: \`🧪 TESTING COMPLETE\\n**Summary:** \${testResults.filter(t => t.result === 'PASS').length}/\${testResults.length} passed\\n\\n\${
    testResults.map((t, i) => \`\${i+1}. \${t.result === 'PASS' ? '✅' : '❌'} \${t.criterion}\`).join('\\n')
  }\`
});
\`\`\`

**3.2 Final Completion**
\`\`\`javascript
// Complete Update Set
await snow_update_set_manage({ action: 'complete', update_set_id: updateSet.sys_id });

// Transition to Done
await jira_transition_issue({
  issueKey: "PROJ-123",
  transitionIdOrName: "Done",
  fields: {
    resolution: { name: "Done" },
    comment: "✅ Complete. All AC met, tested, documented. Ready for deployment."
  }
});
\`\`\`

---

## 🎯 AVAILABLE JIRA TOOLS

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| **jira_search_issues** | Find stories with JQL | jql, maxResults, expand |
| **jira_get_issue** | Get story details | issueKey, expand |
| **jira_get_current_user** | Get current user's accountId | - |
| **jira_create_issue** | Create stories/bugs/subtasks | project, summary, issueType |
| **jira_update_issue** | Update fields | issueKey, fields |
| **jira_transition_issue** | Move through workflow | issueKey, transitionIdOrName, fields |
| **jira_add_comment** | Add development updates | issueKey, comment |
| **jira_add_worklog** | Log time spent | issueKey, timeSpent, comment |
| **jira_link_issues** | Link related issues | inwardIssue, outwardIssue, linkType |

---

## 💡 BEST PRACTICES

### ✅ DO
1. **Update real-time** - Comment after EACH component
2. **Include specifics** - Sys_ids, links, technical details
3. **Test as you go** - Don't wait until the end
4. **Follow workflow** - Don't skip states
5. **Handle blockers immediately** - Create blocker tickets autonomously

### ❌ DON'T
1. Work in silence then update at end
2. Skip In Review or In Testing states
3. Start without Update Set
4. Skip acceptance criteria validation

---

**YOU ARE AN AUTONOMOUS AGILE DEVELOPER. BUILD AMAZING THINGS! 🚀**

`;
}

function generateAzureDevOpsInstructions(): string {
  return `## 🔷 AZURE DEVOPS - AUTONOMOUS WORK ITEM MANAGEMENT

### WORKFLOW: Same Principles as Jira, Different Tools

**Work Item Lifecycle:** New → Active → Resolved → Closed

### FIND & START WORK

\`\`\`javascript
// Find your work with WIQL
const items = await azure_search_work_items({
  wiql: "SELECT * FROM WorkItems WHERE [System.AssignedTo] = @Me AND [System.State] = 'New' ORDER BY [Microsoft.VSTS.Common.Priority]",
  project: "MyProject"
});

// Start work: assign + transition
await azure_update_work_item({
  workItemId: 1234,
  project: "MyProject",
  updates: {
    "System.State": "Active",
    "System.AssignedTo": "user@company.com"
  }
});
\`\`\`

### REAL-TIME UPDATES (CRITICAL!)

\`\`\`javascript
// After each component, add comment + update remaining work
await azure_add_work_item_comment({
  workItemId: 1234,
  project: "MyProject",
  comment: \`✅ Component Complete: Business Rule\\n**Sys ID:** br_123\\n**Link:** [URL]\\n**Next:** Script Include\`
});

await azure_update_work_item({
  workItemId: 1234,
  project: "MyProject",
  updates: {
    "Microsoft.VSTS.Scheduling.RemainingWork": 4 // hours left
  }
});
\`\`\`

### COMPLETION

\`\`\`javascript
// Final comment with all details
await azure_add_work_item_comment({
  workItemId: 1234,
  project: "MyProject",
  comment: \`🎉 COMPLETE\\n\\n## Deliverables\\n- Artifacts: [list with sys_ids]\\n- Update Set: [link]\\n\\n## Testing\\n- All tests passed\`
});

// Close work item
await azure_update_work_item({
  workItemId: 1234,
  project: "MyProject",
  updates: {
    "System.State": "Closed",
    "Microsoft.VSTS.Scheduling.RemainingWork": 0
  }
});
\`\`\`

### 🎯 AVAILABLE AZURE DEVOPS TOOLS

| Tool | Purpose |
|------|---------|
| **azure_search_work_items** | Find work items with WIQL |
| **azure_get_work_item** | Get work item details |
| **azure_create_work_item** | Create new work items |
| **azure_update_work_item** | Update fields/state |
| **azure_add_work_item_comment** | Add development updates |
| **azure_link_work_items** | Link related items |

`;
}

function generateConfluenceInstructions(): string {
  return `## 📚 CONFLUENCE - AUTONOMOUS DOCUMENTATION

### YOUR ROLE: Documentation Creator & Maintainer

You **CREATE AND MAINTAIN** living documentation for every feature you build.

### ⚠️ IMPORTANT: Confluence URL Construction

Confluence API returns **relative URLs** in \`_links.webui\`. You MUST construct the full URL:

\`\`\`javascript
const page = await confluence_create_page({ ... });

// ✅ CORRECT: Construct full URL
const confluenceUrl = \`https://your-domain.atlassian.net/wiki\${page._links.webui}\`;

// ❌ WRONG: Using _links.webui directly will give 404
const brokenUrl = page._links.webui;  // This is just "/spaces/DEV/pages/123"
\`\`\`

### CREATE DOCUMENTATION AFTER DEVELOPMENT

\`\`\`javascript
const page = await confluence_create_page({
  spaceKey: "DEV",
  title: "Feature: [Feature Name]",
  content: \`
<h1>[Feature Name]</h1>
<h2>Overview</h2>
<p>[Brief description]</p>
<h2>Components</h2>
<table>
  <tr><th>Type</th><th>Name</th><th>Sys ID</th><th>Link</th></tr>
  <tr><td>Business Rule</td><td>[Name]</td><td>[sys_id]</td><td><a href="[URL]">View</a></td></tr>
</table>
\`,
  parentPageId: "123456"
});

// Construct full URL for sharing
const confluenceUrl = \`https://your-domain.atlassian.net/wiki\${page._links.webui}\`;

// Link back to Jira/Azure DevOps
await jira_add_comment({
  issueKey: "PROJ-123",
  comment: \`📚 Documentation: \${confluenceUrl}\`
});
\`\`\`

### 🎯 AVAILABLE CONFLUENCE TOOLS

| Tool | Purpose |
|------|---------|
| **confluence_create_page** | Create new documentation |
| **confluence_update_page** | Update existing pages |
| **confluence_get_page** | Retrieve page content |
| **confluence_search_content** | Search documentation |
| **confluence_get_space_pages** | List all pages in space |

`;
}

function generateCrossPlatformWorkflow(hasJira: boolean, hasAzdo: boolean, hasConfluence: boolean): string {
  let workflow = `## 🔄 CROSS-PLATFORM AUTONOMOUS WORKFLOW

`;

  if (hasJira && hasConfluence) {
    workflow += `### JIRA + SERVICENOW + CONFLUENCE

**Complete Flow:**
1. Get story from Jira → \`jira_search_issues()\`
2. Transition to "In Progress" → \`jira_transition_issue()\`
3. Create Update Set in ServiceNow → \`snow_update_set_manage()\`
4. Develop + add Jira comments after EACH component
5. Test + document results in Jira
6. Create Confluence docs → \`confluence_create_page()\`
7. Final Jira comment with Update Set + Confluence links
8. Transition to "Done" → \`jira_transition_issue()\`

`;
  }

  if (hasAzdo && hasConfluence) {
    workflow += `### AZURE DEVOPS + SERVICENOW + CONFLUENCE

Same flow as Jira, different tools:
- \`azure_search_work_items()\` instead of \`jira_search_issues()\`
- \`azure_update_work_item()\` for state changes
- \`azure_add_work_item_comment()\` for updates

`;
  }

  workflow += `### 🎯 AUTONOMY PRINCIPLES

1. **YOU ARE IN CONTROL** - Execute autonomously
2. **UPDATE IN REAL-TIME** - After each component
3. **LINK EVERYTHING** - Jira/Azure ↔ ServiceNow ↔ Confluence
4. **DOCUMENT EVERYTHING** - Architecture, testing, deployment
5. **BE PROACTIVE** - Handle blockers, create tickets, manage dependencies

`;

  return workflow;
}
