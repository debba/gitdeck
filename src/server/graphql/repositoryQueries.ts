export const STARGAZERS_QUERY = `
query($owner:String!, $name:String!, $cursor:String, $direction:OrderDirection!) {
  repository(owner:$owner, name:$name) {
    stargazers(first:100, after:$cursor, orderBy:{field:STARRED_AT, direction:$direction}) {
      totalCount
      pageInfo { endCursor hasNextPage }
      edges { starredAt node { login avatarUrl url } }
    }
  }
}`;

export const FORKS_QUERY = `
query($owner:String!, $name:String!, $cursor:String, $field:RepositoryOrderField!, $direction:OrderDirection!) {
  repository(owner:$owner, name:$name) {
    forks(first:100, after:$cursor, orderBy:{field:$field, direction:$direction}) {
      totalCount
      pageInfo { endCursor hasNextPage }
      nodes {
        nameWithOwner
        owner { login avatarUrl }
        stargazerCount
        forkCount
        pushedAt
        updatedAt
        createdAt
        url
        description
        primaryLanguage { name }
      }
    }
  }
}`;

export const REPO_COUNTS_QUERY = `
query($owner:String!, $name:String!) {
  repository(owner:$owner, name:$name) {
    refs(refPrefix:"refs/heads/", first:1) { totalCount }
    discussions(first:1) { totalCount }
    issues(states:OPEN, first:1) { totalCount }
    pullRequests(states:OPEN, first:1) { totalCount }
    milestones(states:OPEN, first:1) { totalCount }
    releases(first:1) { totalCount }
    defaultBranchRef {
      target {
        ... on Commit { history(first:1) { totalCount } }
      }
    }
  }
}`;

export const DEFAULT_BRANCH_QUERY = `
query($owner:String!, $name:String!) { repository(owner:$owner, name:$name) { defaultBranchRef { name } } }`;

export const BRANCHES_QUERY = `
query($owner:String!, $name:String!, $defaultRef:String!) {
  repository(owner:$owner, name:$name) {
    defaultBranchRef { name }
    refs(refPrefix:"refs/heads/", first:100, orderBy:{field:ALPHABETICAL, direction:ASC}) {
      totalCount
      nodes {
        name
        target {
          ... on Commit {
            committedDate
            author { name user { login } }
          }
        }
        compare(headRef:$defaultRef) { aheadBy behindBy }
      }
    }
  }
}`;

export const DISCUSSIONS_QUERY = `
query($owner:String!, $name:String!) {
  repository(owner:$owner, name:$name) {
    hasDiscussionsEnabled
    discussions(first:50, orderBy:{field:UPDATED_AT, direction:DESC}) {
      totalCount
      nodes {
        title
        url
        createdAt
        updatedAt
        isAnswered
        author { login avatarUrl }
        category { name }
        comments(first:1) { totalCount }
      }
    }
  }
}`;
