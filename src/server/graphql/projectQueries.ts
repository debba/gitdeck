const PROJECT_SUMMARY_FIELDS = `
  id number title url closed shortDescription updatedAt
  items(first: 1) { totalCount }
  owner { __typename ... on User { login } ... on Organization { login } }
`;

export const PROJECTS_LIST_QUERY = `
query {
  viewer {
    projectsV2(first: 50) {
      nodes { ${PROJECT_SUMMARY_FIELDS} }
    }
    repositories(first: 100, ownerAffiliations: [OWNER, COLLABORATOR]) {
      nodes {
        nameWithOwner
        projectsV2(first: 10) {
          nodes { ${PROJECT_SUMMARY_FIELDS} }
        }
      }
    }
    organizations(first: 50) {
      nodes {
        login
        projectsV2(first: 50) {
          nodes { ${PROJECT_SUMMARY_FIELDS} }
        }
        repositories(first: 50) {
          nodes {
            nameWithOwner
            projectsV2(first: 10) {
              nodes { ${PROJECT_SUMMARY_FIELDS} }
            }
          }
        }
      }
    }
  }
}`;

export const PROJECT_QUERY = `
query($id: ID!, $cursor: String) {
  node(id: $id) {
    ... on ProjectV2 {
      id number title url closed shortDescription
      owner { __typename ... on User { login } ... on Organization { login } }
      fields(first: 50) {
        nodes {
          __typename
          ... on ProjectV2FieldCommon { id name dataType }
          ... on ProjectV2SingleSelectField {
            id name dataType
            options { id name color }
          }
          ... on ProjectV2IterationField {
            id name dataType
            configuration { iterations { id title startDate duration } }
          }
        }
      }
      items(first: 100, after: $cursor) {
        totalCount
        pageInfo { endCursor hasNextPage }
        nodes {
          id isArchived type
          content {
            __typename
            ... on Issue {
              id number title url state
              repository { nameWithOwner }
              author { login url }
              labels(first: 10) { nodes { name color description } }
              assignees(first: 5) { nodes { login avatarUrl url } }
              createdAt updatedAt
            }
            ... on PullRequest {
              id number title url state isDraft
              repository { nameWithOwner }
              author { login url }
              labels(first: 10) { nodes { name color description } }
              assignees(first: 5) { nodes { login avatarUrl url } }
              createdAt updatedAt
            }
            ... on DraftIssue {
              id title
              assignees(first: 5) { nodes { login avatarUrl url } }
              createdAt updatedAt
            }
          }
          fieldValues(first: 30) {
            nodes {
              __typename
              ... on ProjectV2ItemFieldSingleSelectValue {
                field { ... on ProjectV2FieldCommon { id name } }
                name optionId
              }
              ... on ProjectV2ItemFieldTextValue {
                field { ... on ProjectV2FieldCommon { id name } }
                text
              }
              ... on ProjectV2ItemFieldNumberValue {
                field { ... on ProjectV2FieldCommon { id name } }
                number
              }
              ... on ProjectV2ItemFieldDateValue {
                field { ... on ProjectV2FieldCommon { id name } }
                date
              }
              ... on ProjectV2ItemFieldIterationValue {
                field { ... on ProjectV2FieldCommon { id name } }
                title iterationId startDate duration
              }
            }
          }
        }
      }
    }
  }
}`;

export const MOVE_MUTATION = `
mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $projectId
    itemId: $itemId
    fieldId: $fieldId
    value: { singleSelectOptionId: $optionId }
  }) { projectV2Item { id } }
}`;

export const CLEAR_FIELD_MUTATION = `
mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!) {
  clearProjectV2ItemFieldValue(input: {
    projectId: $projectId
    itemId: $itemId
    fieldId: $fieldId
  }) { projectV2Item { id } }
}`;
