export function getTaskId(task) {
  return String(
    task.id ||
    task.id_string ||
    task.task_id ||
    task.taskId ||
    task.key ||
    ""
  );
}

export function getTaskName(task) {
  return String(
    task.name ||
    task.task_name ||
    task.taskName ||
    task.title ||
    "Untitled task"
  );
}

export function getStatusName(task) {
  const status =
    task.status?.name ||
    task.status?.display_value ||
    task.status?.value ||
    task.status_name ||
    task.statusName ||
    task.custom_status?.name ||
    task.customStatus?.name ||
    task.task_status ||
    task.status ||
    "";

  if (typeof status === "object" && status !== null) {
    return String(status.name || status.value || status.display_value || "");
  }

  return String(status);
}

export function getOwnerName(task) {
  const owner =
    task.owner?.name ||
    task.owner?.display_name ||
    task.owner_name ||
    task.assignee?.name ||
    task.assignee?.display_name ||
    task.assignee_name ||
    task.person_responsible?.name ||
    task.personResponsible?.name ||
    "Unassigned";

  return String(owner);
}

export function getTaskUrl(task) {
  return String(
    task.web_url ||
    task.webUrl ||
    task.link ||
    task.url ||
    task.task_url ||
    ""
  );
}

export function taskSummary(task) {
  return {
    id: getTaskId(task),
    name: getTaskName(task),
    status: getStatusName(task),
    owner: getOwnerName(task),
    url: getTaskUrl(task)
  };
}
