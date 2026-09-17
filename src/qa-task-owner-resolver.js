import { fetchProjectUsers } from "./zoho-projects-client.js";

export function buildOwnerEmailByTag(projectCliqMentions) {
  const ownerEmailByTag = new Map();

  for (const mention of projectCliqMentions) {
    if (!mention.cliqUserEmail || !mention.tags || mention.tags.length === 0) {
      continue;
    }

    const email = normalizeName(mention.cliqUserEmail);

    for (const rawTag of mention.tags) {
      const tag = normalizeName(rawTag);

      if (!tag) {
        continue;
      }

      const existingEmail = ownerEmailByTag.get(tag);

      if (existingEmail && existingEmail !== email) {
        throw new Error(
          `PROJECT_CLIQ_MENTIONS has conflicting cliqUserEmail values for tag "${rawTag}" (${existingEmail} vs ${email}). Fix the mapping before assigning QA task owners.`
        );
      }

      ownerEmailByTag.set(tag, email);
    }
  }

  return ownerEmailByTag;
}

export function resolveTaskOwnerEmail(task, ownerEmailByTag, defaultOwnerEmail) {
  const matchedEmails = new Set();

  for (const tag of task.tags || []) {
    const ownerEmail = ownerEmailByTag.get(normalizeName(tag.name));

    if (ownerEmail) {
      matchedEmails.add(ownerEmail);
    }
  }

  if (matchedEmails.size > 1) {
    return { email: null, ambiguous: true, matchedEmails: [...matchedEmails] };
  }

  if (matchedEmails.size === 1) {
    return { email: [...matchedEmails][0], ambiguous: false };
  }

  return { email: defaultOwnerEmail || null, ambiguous: false };
}

export async function resolveOwners({ config, accessToken, qaBoard, candidateEmails }) {
  if (candidateEmails.length === 0) {
    return new Map();
  }

  let qaBoardUsers;

  try {
    qaBoardUsers = await fetchProjectUsers(config, accessToken, qaBoard);
  } catch (error) {
    if (isInvalidOAuthScope(error)) {
      console.warn(
        `Warning: cannot resolve QA task owners because the refresh token lacks project-users read access (e.g. ZohoProjects.users.READ). Tasks will be left unassigned until the refresh token is regenerated with that scope.`
      );
      return new Map();
    }

    throw error;
  }

  const userByEmail = new Map(qaBoardUsers.filter((user) => user.email).map((user) => [user.email, user]));
  const ownerByEmail = new Map();
  const missingEmails = [];

  for (const email of candidateEmails) {
    const matchedUser = userByEmail.get(normalizeName(email));

    if (matchedUser) {
      ownerByEmail.set(email, matchedUser);
    } else {
      missingEmails.push(email);
    }
  }

  if (missingEmails.length > 0) {
    console.warn(
      `Warning: these configured owner emails are not members of ${qaBoard.name} and will be skipped: ${missingEmails.join(", ")}.`
    );
  }

  return ownerByEmail;
}

export function taskHasOwner(task, ownerId) {
  const ownerLists = [task.owners_and_work?.owners, task.details?.owners, task.owners];

  return ownerLists.some(
    (owners) => Array.isArray(owners) && owners.some((owner) => String(owner.id || owner.zpuid) === String(ownerId))
  );
}

export function isInvalidOAuthScope(error) {
  return error.response?.data?.error?.title === "INVALID_OAUTHSCOPE";
}

export function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}
