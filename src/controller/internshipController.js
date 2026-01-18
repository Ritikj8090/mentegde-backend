// /mnt/data/internshipController.js
const db = require("../config/db");

/**
 * Helper: build base SELECT with aggregated domains
 */
const safeJson = (value) =>
  value === undefined || value === null
    ? JSON.stringify([])
    : JSON.stringify(value);

const BASE_SELECT_WITH_DOMAINS = `
  SELECT 
    i.*,
    COALESCE(
      json_agg(
        json_build_object(
          'id', d.id,
          'domain_name', d.domain_name,
          'skills', d.skills,
          'tasks', d.tasks,
          'hours', d.hours,
          'start_date', to_char(d.start_date, 'YYYY-MM-DD'),
          'end_date', to_char(d.end_date, 'YYYY-MM-DD'),
          'duration', d.duration,
          'view_details', d.view_details,
          'limit_value', d.limit_value,
          'seats_left', d.seats_left,
          'join_count', d.join_count
        )
      ) FILTER (WHERE d.id IS NOT NULL),
    '[]') AS domains
  FROM mentor.internships i
  LEFT JOIN mentor.internship_domains d ON i.id = d.internship_id
`;

const normalizeMilestoneStatus = (status) => {
  const allowed = new Set(["planned", "active", "completed", "archived"]);
  return allowed.has(status) ? status : "planned";
};

const normalizeConceptStatus = (status) => {
  const allowed = new Set(["draft", "published", "archived"]);
  return allowed.has(status) ? status : "draft";
};

const normalizeTaskStatus = (status) => {
  const allowed = new Set(["todo", "in_progress", "blocked", "done"]);
  return allowed.has(status) ? status : "todo";
};

const normalizeConceptProgressStatus = (status) => {
  const allowed = new Set(["not_started", "in_progress", "completed"]);
  return allowed.has(status) ? status : "in_progress";
};

const normalizeAssignmentStatus = (status) => {
  const allowed = new Set(["draft", "published", "closed"]);
  return allowed.has(status) ? status : "draft";
};

const normalizeAssignmentSubmissionStatus = (status) => {
  const allowed = new Set(["submitted", "late"]);
  return allowed.has(status) ? status : "submitted";
};

const normalizeAssignmentGradeStatus = (status) => {
  const allowed = new Set(["graded", "returned"]);
  return allowed.has(status) ? status : "graded";
};

const createMilestone = async (req, res) => {
  const client = await db.connect();
  try {
    const mentorId = req.user.id;
    const { workboardId } = req.params;
    const {
      title,
      description,
      order_index,
      start_date,
      due_date,
      status,
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ message: "title is required" });
    }

    let orderIndex = 0;
    if (order_index !== undefined && order_index !== null && order_index !== "") {
      const parsedIndex = Number.parseInt(order_index, 10);
      orderIndex = Number.isNaN(parsedIndex) || parsedIndex < 0 ? 0 : parsedIndex;
    }

    await client.query("BEGIN");

    const workboardRes = await client.query(
      `
      SELECT id
      FROM mentedge.workboards
      WHERE id = $1 AND created_by = $2
      `,
      [workboardId, mentorId]
    );

    if (workboardRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Workboard not found" });
    }

    await client.query(
      `
      UPDATE mentedge.milestones
      SET order_index = order_index + 1
      WHERE workboard_id = $1 AND order_index >= $2
      `,
      [workboardId, orderIndex]
    );

    const result = await client.query(
      `
      INSERT INTO mentedge.milestones (
        workboard_id, title, description, order_index, start_date, due_date, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
      `,
      [
        workboardId,
        title.trim(),
        description ?? null,
        orderIndex,
        start_date ?? null,
        due_date ?? null,
        normalizeMilestoneStatus(status),
      ]
    );

    await client.query("COMMIT");
    return res.status(201).json({
      message: "Milestone created",
      milestone: result.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("createMilestone error:", err);
    return res.status(500).json({ message: "Failed to create milestone" });
  } finally {
    client.release();
  }
};

const createConcept = async (req, res) => {
  const { title, description, status, order_index } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({ message: "title is required" });
  }

  let orderIndex = 0;
  if (order_index !== undefined && order_index !== null && order_index !== "") {
    const parsedIndex = Number.parseInt(order_index, 10);
    orderIndex = Number.isNaN(parsedIndex) || parsedIndex < 0 ? 0 : parsedIndex;
  }

  const client = await db.connect();
  try {
    const mentorId = req.user.id;
    const { milestoneId } = req.params;

    await client.query("BEGIN");

    const milestoneRes = await client.query(
      `
      SELECT m.id, w.internship_id, w.domain_name
      FROM mentedge.milestones m
      JOIN mentedge.workboards w ON w.id = m.workboard_id
      WHERE m.id = $1 AND w.created_by = $2
      `,
      [milestoneId, mentorId]
    );

    if (milestoneRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Milestone not found" });
    }

    await client.query(
      `
      UPDATE mentedge.concepts
      SET order_index = order_index + 1
      WHERE milestone_id = $1 AND order_index >= $2
      `,
      [milestoneId, orderIndex]
    );

    const result = await client.query(
      `
      INSERT INTO mentedge.concepts (
        milestone_id, title, description, status, order_index
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [
        milestoneId,
        title.trim(),
        description ?? null,
        normalizeConceptStatus(status),
        orderIndex,
      ]
    );

    const { internship_id, domain_name } = milestoneRes.rows[0];
    const internsRes = await client.query(
      `
      SELECT j.intern_id
      FROM mentedge.internship_joined j
      JOIN mentedge.internship_domains d ON d.id = j.domain_id
      WHERE j.internship_id = $1 AND d.domain_name = $2
      `,
      [internship_id, domain_name]
    );

    const internIds = internsRes.rows.map((row) => row.intern_id);
    if (internIds.length > 0) {
      await client.query(
        `
        INSERT INTO mentedge.concept_progress (concept_id, intern_id, status)
        SELECT $1, unnest($2::uuid[]), 'not_started'
        ON CONFLICT DO NOTHING
        `,
        [result.rows[0].id, internIds]
      );
    }

    await client.query("COMMIT");
    return res.status(201).json({
      message: "Concept created",
      concept: result.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("createConcept error:", err);
    return res.status(500).json({ message: "Failed to create concept" });
  } finally {
    client.release();
  }
};

const createTask = async (req, res) => {
  const {
    title,
    description,
    status,
    assigned_to,
    assigned_to_ids,
    due_date,
  } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({ message: "title is required" });
  }

  const rawAssignedTo =
    Array.isArray(assigned_to_ids) && assigned_to_ids.length > 0
      ? assigned_to_ids
      : assigned_to;
  const assignedToIds = Array.isArray(rawAssignedTo)
    ? rawAssignedTo.filter(Boolean)
    : rawAssignedTo
      ? [rawAssignedTo]
      : [];
  const uniqueAssignedToIds = [...new Set(assignedToIds)];
  const taskAssignedTo =
    uniqueAssignedToIds.length === 1 ? uniqueAssignedToIds[0] : null;

  const client = await db.connect();
  try {
    const mentorId = req.user.id;
    const { milestoneId } = req.params;

    await client.query("BEGIN");

    const milestoneRes = await client.query(
      `
      SELECT m.id, w.internship_id, w.domain_name
      FROM mentedge.milestones m
      JOIN mentedge.workboards w ON w.id = m.workboard_id
      WHERE m.id = $1 AND w.created_by = $2
      `,
      [milestoneId, mentorId]
    );

    if (milestoneRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Milestone not found" });
    }

    const result = await client.query(
      `
      INSERT INTO mentedge.tasks (
        milestone_id, title, description, status, assigned_to, created_by, due_date
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
      `,
      [
        milestoneId,
        title.trim(),
        description ?? null,
        normalizeTaskStatus(status),
        taskAssignedTo,
        mentorId,
        due_date ?? null,
      ]
    );

    if (uniqueAssignedToIds.length > 0) {
      await client.query(
        `
        INSERT INTO mentedge.task_assignments (task_id, intern_id)
        SELECT $1, unnest($2::uuid[])
        ON CONFLICT DO NOTHING
        `,
        [result.rows[0].id, uniqueAssignedToIds]
      );
    }

    let taskInternIds = uniqueAssignedToIds;
    if (taskInternIds.length === 0) {
      const { internship_id, domain_name } = milestoneRes.rows[0];
      const internsRes = await client.query(
        `
        SELECT j.intern_id
        FROM mentedge.internship_joined j
        JOIN mentedge.internship_domains d ON d.id = j.domain_id
        WHERE j.internship_id = $1 AND d.domain_name = $2
        `,
        [internship_id, domain_name]
      );
      taskInternIds = internsRes.rows.map((row) => row.intern_id);
    }

    if (taskInternIds.length > 0) {
      await client.query(
        `
        INSERT INTO mentedge.task_progress (task_id, intern_id, status)
        SELECT $1, unnest($2::uuid[]), 'todo'
        ON CONFLICT DO NOTHING
        `,
        [result.rows[0].id, taskInternIds]
      );
    }

    await client.query("COMMIT");
    return res.status(201).json({
      message: "Task created",
      task: result.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("createTask error:", err);
    return res.status(500).json({ message: "Failed to create task" });
  } finally {
    client.release();
  }
};

const updateConcept = async (req, res) => {
  const { title, description, status, order_index } = req.body;
  const { conceptId } = req.params;

  if (!conceptId) {
    return res.status(400).json({ message: "conceptId is required" });
  }

  const client = await db.connect();
  try {
    const mentorId = req.user.id;
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (title !== undefined) {
      if (!title || !title.trim()) {
        return res.status(400).json({ message: "title cannot be empty" });
      }
      updates.push(`title = $${paramIndex++}`);
      values.push(title.trim());
    }

    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(description ?? null);
    }

    if (status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(normalizeConceptStatus(status));
    }

    let orderIndex = null;
    if (order_index !== undefined) {
      const parsedIndex = Number.parseInt(order_index, 10);
      orderIndex = Number.isNaN(parsedIndex) || parsedIndex < 0 ? 0 : parsedIndex;
      updates.push(`order_index = $${paramIndex++}`);
      values.push(orderIndex);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: "No fields to update" });
    }

    await client.query("BEGIN");

    const conceptRes = await client.query(
      `
      SELECT c.id, c.order_index, c.milestone_id, w.id AS workboard_id
      FROM mentedge.concepts c
      JOIN mentedge.milestones m ON m.id = c.milestone_id
      JOIN mentedge.workboards w ON w.id = m.workboard_id
      WHERE c.id = $1 AND w.created_by = $2
      `,
      [conceptId, mentorId]
    );

    if (conceptRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Concept not found" });
    }

    const concept = conceptRes.rows[0];

    if (orderIndex !== null && orderIndex !== concept.order_index) {
      if (orderIndex > concept.order_index) {
        await client.query(
          `
          UPDATE mentedge.concepts
          SET order_index = order_index - 1
          WHERE milestone_id = $1
            AND order_index > $2
            AND order_index <= $3
          `,
          [concept.milestone_id, concept.order_index, orderIndex]
        );
      } else {
        await client.query(
          `
          UPDATE mentedge.concepts
          SET order_index = order_index + 1
          WHERE milestone_id = $1
            AND order_index >= $2
            AND order_index < $3
          `,
          [concept.milestone_id, orderIndex, concept.order_index]
        );
      }
    }

    const updateQuery = `
      UPDATE mentedge.concepts
      SET ${updates.join(", ")}, updated_at = NOW()
      WHERE id = $${paramIndex}
      RETURNING *
    `;
    values.push(conceptId);

    const result = await client.query(updateQuery, values);

    await client.query("COMMIT");
    return res.status(200).json({
      message: "Concept updated",
      concept: result.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("updateConcept error:", err);
    return res.status(500).json({ message: "Failed to update concept" });
  } finally {
    client.release();
  }
};

const updateTask = async (req, res) => {
  const { taskId } = req.params;
  const { title, description, status, due_date, assigned_to, assigned_to_ids } =
    req.body;

  if (!taskId) {
    return res.status(400).json({ message: "taskId is required" });
  }

  const updateAssignments =
    assigned_to_ids !== undefined || assigned_to !== undefined;
  const rawAssignedTo =
    Array.isArray(assigned_to_ids) && assigned_to_ids.length > 0
      ? assigned_to_ids
      : assigned_to;
  const assignedToIds = Array.isArray(rawAssignedTo)
    ? rawAssignedTo.filter(Boolean)
    : rawAssignedTo
      ? [rawAssignedTo]
      : [];
  const uniqueAssignedToIds = [...new Set(assignedToIds)];
  const taskAssignedTo =
    updateAssignments && uniqueAssignedToIds.length === 1
      ? uniqueAssignedToIds[0]
      : updateAssignments
        ? null
        : undefined;

  const client = await db.connect();
  try {
    const mentorId = req.user.id;
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (title !== undefined) {
      if (!title || !title.trim()) {
        return res.status(400).json({ message: "title cannot be empty" });
      }
      updates.push(`title = $${paramIndex++}`);
      values.push(title.trim());
    }

    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(description ?? null);
    }

    if (status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(normalizeTaskStatus(status));
    }

    if (due_date !== undefined) {
      updates.push(`due_date = $${paramIndex++}`);
      values.push(due_date ?? null);
    }

    if (updateAssignments) {
      updates.push(`assigned_to = $${paramIndex++}`);
      values.push(taskAssignedTo);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: "No fields to update" });
    }

    await client.query("BEGIN");

    const taskRes = await client.query(
      `
      SELECT t.id, w.internship_id, w.domain_name
      FROM mentedge.tasks t
      JOIN mentedge.milestones m ON m.id = t.milestone_id
      JOIN mentedge.workboards w ON w.id = m.workboard_id
      WHERE t.id = $1 AND w.created_by = $2
      `,
      [taskId, mentorId]
    );

    if (taskRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Task not found" });
    }

    const { internship_id, domain_name } = taskRes.rows[0];

    if (updateAssignments) {
      if (uniqueAssignedToIds.length > 0) {
        await client.query(
          `
          DELETE FROM mentedge.task_assignments
          WHERE task_id = $1
            AND intern_id <> ALL($2::uuid[])
          `,
          [taskId, uniqueAssignedToIds]
        );

        await client.query(
          `
          INSERT INTO mentedge.task_assignments (task_id, intern_id)
          SELECT $1, unnest($2::uuid[])
          ON CONFLICT DO NOTHING
          `,
          [taskId, uniqueAssignedToIds]
        );

        await client.query(
          `
          INSERT INTO mentedge.task_progress (task_id, intern_id, status)
          SELECT $1, unnest($2::uuid[]), 'todo'
          ON CONFLICT DO NOTHING
          `,
          [taskId, uniqueAssignedToIds]
        );
      } else {
        await client.query(
          `
          DELETE FROM mentedge.task_assignments
          WHERE task_id = $1
          `,
          [taskId]
        );

        const internsRes = await client.query(
          `
          SELECT j.intern_id
          FROM mentedge.internship_joined j
          JOIN mentedge.internship_domains d ON d.id = j.domain_id
          WHERE j.internship_id = $1 AND d.domain_name = $2
          `,
          [internship_id, domain_name]
        );

        const internIds = internsRes.rows.map((row) => row.intern_id);
        if (internIds.length > 0) {
          await client.query(
            `
            INSERT INTO mentedge.task_progress (task_id, intern_id, status)
            SELECT $1, unnest($2::uuid[]), 'todo'
            ON CONFLICT DO NOTHING
            `,
            [taskId, internIds]
          );
        }
      }
    }

    const updateQuery = `
      UPDATE mentedge.tasks
      SET ${updates.join(", ")}, updated_at = NOW()
      WHERE id = $${paramIndex}
      RETURNING *
    `;
    values.push(taskId);

    const result = await client.query(updateQuery, values);

    await client.query("COMMIT");
    return res.status(200).json({
      message: "Task updated",
      task: result.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("updateTask error:", err);
    return res.status(500).json({ message: "Failed to update task" });
  } finally {
    client.release();
  }
};

const updateAssignment = async (req, res) => {
  const { assignmentId } = req.params;
  const {
    title,
    description,
    status,
    max_score,
    due_date,
    assigned_to,
    assigned_to_ids,
    assign_all,
  } = req.body;

  if (!assignmentId) {
    return res.status(400).json({ message: "assignmentId is required" });
  }

  const updateAssignments =
    assigned_to_ids !== undefined ||
    assigned_to !== undefined ||
    assign_all !== undefined;
  const rawAssignedTo =
    Array.isArray(assigned_to_ids) && assigned_to_ids.length > 0
      ? assigned_to_ids
      : assigned_to;
  const assignedToIds = Array.isArray(rawAssignedTo)
    ? rawAssignedTo.filter(Boolean)
    : rawAssignedTo
      ? [rawAssignedTo]
      : [];
  const uniqueAssignedToIds = [...new Set(assignedToIds)];
  const assignAll = assign_all === true || assign_all === "true";

  const client = await db.connect();
  try {
    const mentorId = req.user.id;
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (title !== undefined) {
      if (!title || !title.trim()) {
        return res.status(400).json({ message: "title cannot be empty" });
      }
      updates.push(`title = $${paramIndex++}`);
      values.push(title.trim());
    }

    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(description ?? null);
    }

    if (status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(normalizeAssignmentStatus(status));
    }

    if (max_score !== undefined) {
      const parsedScore = Number.parseInt(max_score, 10);
      if (Number.isNaN(parsedScore) || parsedScore <= 0) {
        return res
          .status(400)
          .json({ message: "max_score must be a positive integer" });
      }
      updates.push(`max_score = $${paramIndex++}`);
      values.push(parsedScore);
    }

    if (due_date !== undefined) {
      updates.push(`due_date = $${paramIndex++}`);
      values.push(due_date ?? null);
    }

    if (updates.length === 0 && !updateAssignments) {
      return res.status(400).json({ message: "No fields to update" });
    }

    await client.query("BEGIN");

    const assignmentRes = await client.query(
      `
      SELECT a.id, w.internship_id, w.domain_name
      FROM mentedge.assignments a
      JOIN mentedge.milestones m ON m.id = a.milestone_id
      JOIN mentedge.workboards w ON w.id = m.workboard_id
      WHERE a.id = $1 AND w.created_by = $2
      `,
      [assignmentId, mentorId]
    );

    if (assignmentRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Assignment not found" });
    }

    const { internship_id, domain_name } = assignmentRes.rows[0];

    if (updateAssignments) {
      if (assignAll || uniqueAssignedToIds.length === 0) {
        await client.query(
          `
          DELETE FROM mentedge.assignment_assignments
          WHERE assignment_id = $1
          `,
          [assignmentId]
        );

        const internsRes = await client.query(
          `
          SELECT j.intern_id
          FROM mentedge.internship_joined j
          JOIN mentedge.internship_domains d ON d.id = j.domain_id
          WHERE j.internship_id = $1 AND d.domain_name = $2
          `,
          [internship_id, domain_name]
        );

        const internIds = internsRes.rows.map((row) => row.intern_id);
        if (internIds.length > 0) {
          await client.query(
            `
            INSERT INTO mentedge.assignment_submissions (
              assignment_id, intern_id, status
            )
            SELECT $1, unnest($2::uuid[]), 'not_started'
            ON CONFLICT DO NOTHING
            `,
            [assignmentId, internIds]
          );
        }
      } else {
        await client.query(
          `
          DELETE FROM mentedge.assignment_assignments
          WHERE assignment_id = $1
            AND intern_id <> ALL($2::uuid[])
          `,
          [assignmentId, uniqueAssignedToIds]
        );

        await client.query(
          `
          INSERT INTO mentedge.assignment_assignments (assignment_id, intern_id)
          SELECT $1, unnest($2::uuid[])
          ON CONFLICT DO NOTHING
          `,
          [assignmentId, uniqueAssignedToIds]
        );

        await client.query(
          `
          DELETE FROM mentedge.assignment_submissions
          WHERE assignment_id = $1
            AND intern_id <> ALL($2::uuid[])
          `,
          [assignmentId, uniqueAssignedToIds]
        );

        await client.query(
          `
          INSERT INTO mentedge.assignment_submissions (
            assignment_id, intern_id, status
          )
          SELECT $1, unnest($2::uuid[]), 'not_started'
          ON CONFLICT DO NOTHING
          `,
          [assignmentId, uniqueAssignedToIds]
        );
      }
    }

    let updatedAssignment = null;
    if (updates.length > 0) {
      const updateQuery = `
        UPDATE mentedge.assignments
        SET ${updates.join(", ")}, updated_at = NOW()
        WHERE id = $${paramIndex}
        RETURNING *
      `;
      values.push(assignmentId);
      const result = await client.query(updateQuery, values);
      updatedAssignment = result.rows[0];
    } else {
      const result = await client.query(
        `
        SELECT * FROM mentedge.assignments WHERE id = $1
        `,
        [assignmentId]
      );
      updatedAssignment = result.rows[0];
    }

    await client.query("COMMIT");
    return res.status(200).json({
      message: "Assignment updated",
      assignment: updatedAssignment,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("updateAssignment error:", err);
    return res.status(500).json({ message: "Failed to update assignment" });
  } finally {
    client.release();
  }
};

const createAssignment = async (req, res) => {
  const {
    title,
    description,
    status,
    max_score,
    due_date,
    assigned_to,
    assigned_to_ids,
    assign_all,
  } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({ message: "title is required" });
  }

  const rawAssignedTo =
    Array.isArray(assigned_to_ids) && assigned_to_ids.length > 0
      ? assigned_to_ids
      : assigned_to;
  const assignedToIds = Array.isArray(rawAssignedTo)
    ? rawAssignedTo.filter(Boolean)
    : rawAssignedTo
      ? [rawAssignedTo]
      : [];
  const uniqueAssignedToIds = [...new Set(assignedToIds)];
  const assignAll = assign_all === true || assign_all === "true";

  const client = await db.connect();
  try {
    const mentorId = req.user.id;
    const { milestoneId } = req.params;

    await client.query("BEGIN");

    const milestoneRes = await client.query(
      `
      SELECT m.id, w.internship_id, w.domain_name
      FROM mentedge.milestones m
      JOIN mentedge.workboards w ON w.id = m.workboard_id
      WHERE m.id = $1 AND w.created_by = $2
      `,
      [milestoneId, mentorId]
    );

    if (milestoneRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Milestone not found" });
    }

    const { internship_id, domain_name } = milestoneRes.rows[0];

    const result = await client.query(
      `
      INSERT INTO mentedge.assignments (
        milestone_id, title, description, status, max_score, due_date, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
      `,
      [
        milestoneId,
        title.trim(),
        description ?? null,
        normalizeAssignmentStatus(status),
        Number.isInteger(max_score) && max_score > 0 ? max_score : 100,
        due_date ?? null,
        mentorId,
      ]
    );

    let assignmentInternIds = uniqueAssignedToIds;
    if (assignAll) {
      const internsRes = await client.query(
        `
        SELECT j.intern_id
        FROM mentedge.internship_joined j
        JOIN mentedge.internship_domains d ON d.id = j.domain_id
        WHERE j.internship_id = $1
          AND d.domain_name = $2
        `,
        [internship_id, domain_name]
      );
      assignmentInternIds = [
        ...new Set([
          ...assignmentInternIds,
          ...internsRes.rows.map((row) => row.intern_id),
        ]),
      ];
    }

    if (assignmentInternIds.length > 0) {
      await client.query(
        `
        INSERT INTO mentedge.assignment_assignments (assignment_id, intern_id)
        SELECT $1, unnest($2::uuid[])
        ON CONFLICT DO NOTHING
        `,
        [result.rows[0].id, assignmentInternIds]
      );
    }

    if (assignmentInternIds.length === 0) {
      const internsRes = await client.query(
        `
        SELECT j.intern_id
        FROM mentedge.internship_joined j
        JOIN mentedge.internship_domains d ON d.id = j.domain_id
        WHERE j.internship_id = $1
          AND d.domain_name = $2
        `,
        [internship_id, domain_name]
      );
      assignmentInternIds = internsRes.rows.map((row) => row.intern_id);
    }

    if (assignmentInternIds.length > 0) {
      await client.query(
        `
        INSERT INTO mentedge.assignment_submissions (
          assignment_id, intern_id, status
        )
        SELECT $1, unnest($2::uuid[]), 'not_started'
        ON CONFLICT DO NOTHING
        `,
        [result.rows[0].id, assignmentInternIds]
      );
    }

    await client.query("COMMIT");
    return res.status(201).json({
      message: "Assignment created",
      assignment: result.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("createAssignment error:", err);
    return res.status(500).json({ message: "Failed to create assignment" });
  } finally {
    client.release();
  }
};

const getCurrentMentorWorkboard = async (req, res) => {
  try {
    const mentorId = req.user.id;
    const { internshipId } = req.params;

    if (!internshipId) {
      return res.status(400).json({ message: "internshipId is required" });
    }

    const result = await db.query(
      `
      SELECT
        w.id,
        w.internship_id,
        w.domain_name,
        w.created_by,
        w.title,
        w.description,
        w.created_at,
        w.updated_at,
        COALESCE(
          json_agg(
            json_build_object(
              'id', m.id,
              'workboard_id', m.workboard_id,
              'title', m.title,
              'description', m.description,
              'order_index', m.order_index,
              'start_date', m.start_date,
              'due_date', m.due_date,
              'status', m.status,
              'created_at', m.created_at,
              'updated_at', m.updated_at,
              'concepts', COALESCE(c.concepts, '[]'::json),
              'tasks', COALESCE(t.tasks, '[]'::json),
              'assignments', COALESCE(a.assignments, '[]'::json)
            )
            ORDER BY m.order_index, m.created_at
          ) FILTER (WHERE m.id IS NOT NULL),
          '[]'::json
        ) AS milestones
      FROM mentedge.workboards w
      JOIN mentedge.internship_hosts h
        ON h.internship_id = w.internship_id
       AND h.mentor_id = $2
       AND (
         h.role = 'host'
         OR (h.role = 'co-host' AND h.invite_status = 'accepted')
       )
      LEFT JOIN mentedge.milestones m ON m.workboard_id = w.id
      LEFT JOIN LATERAL (
        SELECT json_agg(
          json_build_object(
            'id', c.id,
            'milestone_id', c.milestone_id,
            'title', c.title,
            'description', c.description,
            'status', c.status,
            'order_index', c.order_index,
            'progress', json_build_object(
              'status', COALESCE(cp.status, 'not_started'),
              'completed_at', cp.completed_at,
              'updated_at', cp.updated_at
            ),
            'created_at', c.created_at,
            'updated_at', c.updated_at
          )
          ORDER BY c.order_index, c.created_at
        ) AS concepts
        FROM mentedge.concepts c
        LEFT JOIN mentedge.concept_progress cp
          ON cp.concept_id = c.id AND cp.intern_id = $2
        WHERE c.milestone_id = m.id
      ) c ON true
      LEFT JOIN LATERAL (
        SELECT json_agg(
          json_build_object(
            'id', t.id,
            'milestone_id', t.milestone_id,
            'title', t.title,
            'description', t.description,
            'status', t.status,
            'assigned_to', t.assigned_to,
            'assignees', COALESCE(
              ta.assignees,
              CASE
                WHEN t.assigned_to IS NOT NULL THEN json_build_array(t.assigned_to)
                ELSE '[]'::json
              END
            ),
            'progress', json_build_object(
              'status', COALESCE(tp.status, 'todo'),
              'completed_at', tp.completed_at,
              'updated_at', tp.updated_at
            ),
            'created_by', t.created_by,
            'due_date', t.due_date,
            'completed_at', t.completed_at,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          )
          ORDER BY t.created_at
        ) AS tasks
        FROM mentedge.tasks t
        LEFT JOIN mentedge.task_progress tp
          ON tp.task_id = t.id AND tp.intern_id = $2
        LEFT JOIN LATERAL (
          SELECT json_agg(ta.intern_id ORDER BY ta.assigned_at) AS assignees
          FROM mentedge.task_assignments ta
          WHERE ta.task_id = t.id
        ) ta ON true
        WHERE t.milestone_id = m.id
      ) t ON true
      LEFT JOIN LATERAL (
        SELECT json_agg(
          json_build_object(
            'id', a.id,
            'milestone_id', a.milestone_id,
            'title', a.title,
            'description', a.description,
            'status', a.status,
            'max_score', a.max_score,
            'due_date', a.due_date,
            'created_by', a.created_by,
            'assignees', COALESCE(aa.assignees, '[]'::json),
            'progress', json_build_object(
              'id', s.id,
              'status', COALESCE(s.status, 'not_started'),
              'text_content', s.text_content,
              'score', s.score,
              'feedback', s.feedback,
              'submitted_at', s.submitted_at,
              'graded_at', s.graded_at,
              'updated_at', s.updated_at
            ),
            'created_at', a.created_at,
            'updated_at', a.updated_at
          )
          ORDER BY a.created_at
        ) AS assignments
        FROM mentedge.assignments a
        LEFT JOIN mentedge.assignment_submissions s
          ON s.assignment_id = a.id AND s.intern_id = $2
        LEFT JOIN LATERAL (
          SELECT json_agg(aa.intern_id ORDER BY aa.assigned_at) AS assignees
          FROM mentedge.assignment_assignments aa
          WHERE aa.assignment_id = a.id
        ) aa ON true
        WHERE a.milestone_id = m.id
      ) a ON true
      WHERE w.internship_id = $1
        AND w.domain_name = h.domain
      GROUP BY
        w.id,
        w.internship_id,
        w.domain_name,
        w.created_by,
        w.title,
        w.description,
        w.created_at,
        w.updated_at
      LIMIT 1
      `,
      [internshipId, mentorId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Workboard not found" });
    }

    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error("getCurrentMentorWorkboard error:", err);
    return res.status(500).json({ message: "Failed to fetch workboard" });
  }
};

const getInternWorkboard = async (req, res) => {
  try {
    const internId = req.user?.id || req.params.internId;
    const { internshipId } = req.params;

    if (!internId) {
      return res.status(400).json({ message: "internId is required" });
    }

    if (!internshipId) {
      return res.status(400).json({ message: "internshipId is required" });
    }

    const result = await db.query(
      `
      SELECT
        w.id,
        w.internship_id,
        w.domain_name,
        w.created_by,
        w.title,
        w.description,
        w.created_at,
        w.updated_at,
        COALESCE(
          json_agg(
            json_build_object(
              'id', m.id,
              'workboard_id', m.workboard_id,
              'title', m.title,
              'description', m.description,
              'order_index', m.order_index,
              'start_date', m.start_date,
              'due_date', m.due_date,
              'status', m.status,
              'created_at', m.created_at,
              'updated_at', m.updated_at,
              'concepts', COALESCE(c.concepts, '[]'::json),
              'tasks', COALESCE(t.tasks, '[]'::json),
              'assignments', COALESCE(a.assignments, '[]'::json)
            )
            ORDER BY m.order_index, m.created_at
          ) FILTER (WHERE m.id IS NOT NULL),
          '[]'::json
        ) AS milestones
      FROM mentedge.workboards w
      JOIN mentedge.internship_joined j
        ON j.internship_id = w.internship_id
      JOIN mentedge.internship_domains d
        ON d.id = j.domain_id
      LEFT JOIN mentedge.milestones m ON m.workboard_id = w.id
      LEFT JOIN LATERAL (
        SELECT json_agg(
          json_build_object(
            'id', c.id,
            'milestone_id', c.milestone_id,
            'title', c.title,
            'description', c.description,
            'status', c.status,
            'order_index', c.order_index,
            'progress', json_build_object(
              'status', cp.status,
              'completed_at', cp.completed_at,
              'updated_at', cp.updated_at
            ),
            'created_at', c.created_at,
            'updated_at', c.updated_at
          )
          ORDER BY c.order_index, c.created_at
        ) AS concepts
        FROM mentedge.concepts c
        LEFT JOIN mentedge.concept_progress cp
          ON cp.concept_id = c.id AND cp.intern_id = $2
        WHERE c.milestone_id = m.id
      ) c ON true
      LEFT JOIN LATERAL (
        SELECT json_agg(
          json_build_object(
            'id', t.id,
            'milestone_id', t.milestone_id,
            'title', t.title,
            'description', t.description,
            'status', t.status,
            'assigned_to', t.assigned_to,
            'assignees', COALESCE(
              ta.assignees,
              CASE
                WHEN t.assigned_to IS NOT NULL THEN json_build_array(t.assigned_to)
                ELSE '[]'::json
              END
            ),
            'progress', json_build_object(
              'status', tp.status,
              'completed_at', tp.completed_at,
              'updated_at', tp.updated_at
            ),
            'created_by', t.created_by,
            'due_date', t.due_date,
            'completed_at', t.completed_at,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          )
          ORDER BY t.created_at
        ) AS tasks
        FROM mentedge.tasks t
        LEFT JOIN mentedge.task_progress tp
          ON tp.task_id = t.id AND tp.intern_id = $2
        LEFT JOIN LATERAL (
          SELECT json_agg(ta.intern_id ORDER BY ta.assigned_at) AS assignees
          FROM mentedge.task_assignments ta
          WHERE ta.task_id = t.id
        ) ta ON true
        WHERE t.milestone_id = m.id
      ) t ON true
      LEFT JOIN LATERAL (
        SELECT json_agg(
          json_build_object(
            'id', a.id,
            'milestone_id', a.milestone_id,
            'title', a.title,
            'description', a.description,
            'status', a.status,
            'max_score', a.max_score,
            'due_date', a.due_date,
            'created_by', a.created_by,
            'assignees', COALESCE(aa.assignees, '[]'::json),
            'created_at', a.created_at,
            'updated_at', a.updated_at
          )
          ORDER BY a.created_at
        ) AS assignments
        FROM mentedge.assignments a
        LEFT JOIN LATERAL (
          SELECT json_agg(aa.intern_id ORDER BY aa.assigned_at) AS assignees
          FROM mentedge.assignment_assignments aa
          WHERE aa.assignment_id = a.id
        ) aa ON true
        WHERE a.milestone_id = m.id
      ) a ON true
      WHERE j.intern_id = $2
        AND w.internship_id = $1
        AND w.domain_name = d.domain_name
      GROUP BY
        w.id,
        w.internship_id,
        w.domain_name,
        w.created_by,
        w.title,
        w.description,
        w.created_at,
        w.updated_at
      LIMIT 1
      `,
      [internshipId, internId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Workboard not found" });
    }

    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error("getInternWorkboard error:", err);
    return res.status(500).json({ message: "Failed to fetch workboard" });
  }
};

const getDomainInterns = async (req, res) => {
  try {
    const mentorId = req.user.id;
    const { internshipId, domainName } = req.params;

    if (!internshipId || !domainName) {
      return res
        .status(400)
        .json({ message: "internshipId and domainName are required" });
    }

    const result = await db.query(
      `
      SELECT
        u.id,
        u.full_name,
        u.email,
        u.avatar,
        u.created_at,
        j.joined_at,
        d.domain_name
      FROM mentedge.internship_joined j
      JOIN mentedge.internship_domains d ON d.id = j.domain_id
      JOIN mentedge.users u ON u.id = j.intern_id
      JOIN mentedge.internship_hosts h
        ON h.internship_id = j.internship_id
       AND h.mentor_id = $3
       AND (
         h.role = 'host'
         OR (
           h.role = 'co-host'
           AND h.invite_status = 'accepted'
           AND h.domain = d.domain_name
         )
       )
      WHERE j.internship_id = $1
        AND d.domain_name = $2
      ORDER BY j.joined_at DESC
      `,
      [internshipId, domainName, mentorId]
    );

    return res.status(200).json(result.rows);
  } catch (err) {
    console.error("getDomainInterns error:", err);
    return res.status(500).json({ message: "Failed to fetch interns" });
  }
};

const uploadConceptFiles = async (req, res) => {
  try {
    console.log(req.files);
    const userId = req.user?.id;
    const role = req.user?.role;
    const { conceptId } = req.params;
    const files = Array.isArray(req.files) ? req.files : [];

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!conceptId) {
      return res.status(400).json({ message: "conceptId is required" });
    }

    if (files.length === 0) {
      return res.status(400).json({ message: "No files uploaded" });
    }

    const conceptRes = await db.query(
      `
      SELECT c.id, w.internship_id, w.domain_name, w.created_by
      FROM mentedge.concepts c
      JOIN mentedge.milestones m ON m.id = c.milestone_id
      JOIN mentedge.workboards w ON w.id = m.workboard_id
      WHERE c.id = $1
      `,
      [conceptId]
    );

    if (conceptRes.rowCount === 0) {
      return res.status(404).json({ message: "Concept not found" });
    }

    const concept = conceptRes.rows[0];

    if (role === "mentor") {
      if (concept.created_by !== userId) {
        return res.status(403).json({ message: "Not allowed to upload" });
      }
    } else {
      const joinedRes = await db.query(
        `
        SELECT 1
        FROM mentedge.internship_joined j
        JOIN mentedge.internship_domains d ON d.id = j.domain_id
        WHERE j.intern_id = $1
          AND j.internship_id = $2
          AND d.domain_name = $3
        `,
        [userId, concept.internship_id, concept.domain_name]
      );

      if (joinedRes.rowCount === 0) {
        return res.status(403).json({ message: "Not allowed to upload" });
      }
    }

    const fileUrls = files.map((file) => file.path);
    const fileNames = files.map((file) => file.originalname || file.filename);
    const fileTypes = files.map((file) => file.mimetype);

    const result = await db.query(
      `
      INSERT INTO mentedge.concept_files (
        concept_id, file_url, file_name, file_type, uploaded_by_user_id, uploaded_by_mentor_id
      )
      SELECT
        $1,
        f.file_url,
        f.file_name,
        f.file_type,
        $2,
        $3
      FROM unnest($4::text[], $5::text[], $6::text[]) AS f(file_url, file_name, file_type)
      RETURNING *
      `,
      [
        conceptId,
        role === "user" ? userId : null,
        role === "mentor" ? userId : null,
        fileUrls,
        fileNames,
        fileTypes,
      ]
    );

    return res.status(201).json({
      message: "Concept files uploaded",
      files: result.rows,
    });
  } catch (err) {
    console.error("uploadConceptFiles error:", err);
    return res.status(500).json({ message: "Failed to upload concept files" });
  }
};

const getConceptFiles = async (req, res) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;
    const { conceptId } = req.params;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!conceptId) {
      return res.status(400).json({ message: "conceptId is required" });
    }

    const conceptRes = await db.query(
      `
      SELECT c.id, w.internship_id, w.domain_name, w.created_by
      FROM mentedge.concepts c
      JOIN mentedge.milestones m ON m.id = c.milestone_id
      JOIN mentedge.workboards w ON w.id = m.workboard_id
      WHERE c.id = $1
      `,
      [conceptId]
    );

    if (conceptRes.rowCount === 0) {
      return res.status(404).json({ message: "Concept not found" });
    }

    const concept = conceptRes.rows[0];

    if (role === "mentor") {
      if (concept.created_by !== userId) {
        return res.status(403).json({ message: "Not allowed to view files" });
      }
    } else {
      const joinedRes = await db.query(
        `
        SELECT 1
        FROM mentedge.internship_joined j
        JOIN mentedge.internship_domains d ON d.id = j.domain_id
        WHERE j.intern_id = $1
          AND j.internship_id = $2
          AND d.domain_name = $3
        `,
        [userId, concept.internship_id, concept.domain_name]
      );

      if (joinedRes.rowCount === 0) {
        return res.status(403).json({ message: "Not allowed to view files" });
      }
    }

    const result = await db.query(
      `
      SELECT
        id,
        concept_id,
        file_url,
        file_name,
        file_type,
        uploaded_by_user_id,
        uploaded_by_mentor_id,
        created_at
      FROM mentedge.concept_files
      WHERE concept_id = $1
      ORDER BY created_at DESC
      `,
      [conceptId]
    );

    return res.status(200).json(result.rows);
  } catch (err) {
    console.error("getConceptFiles error:", err);
    return res.status(500).json({ message: "Failed to fetch concept files" });
  }
};

const deleteConceptFile = async (req, res) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;
    const { conceptId, fileId } = req.params;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!conceptId || !fileId) {
      return res
        .status(400)
        .json({ message: "conceptId and fileId are required" });
    }

    const conceptRes = await db.query(
      `
      SELECT c.id, w.internship_id, w.domain_name, w.created_by
      FROM mentedge.concepts c
      JOIN mentedge.milestones m ON m.id = c.milestone_id
      JOIN mentedge.workboards w ON w.id = m.workboard_id
      WHERE c.id = $1
      `,
      [conceptId]
    );

    if (conceptRes.rowCount === 0) {
      return res.status(404).json({ message: "Concept not found" });
    }

    const concept = conceptRes.rows[0];

    if (role === "mentor") {
      if (concept.created_by !== userId) {
        return res.status(403).json({ message: "Not allowed to delete files" });
      }
    } else {
      const joinedRes = await db.query(
        `
        SELECT 1
        FROM mentedge.internship_joined j
        JOIN mentedge.internship_domains d ON d.id = j.domain_id
        WHERE j.intern_id = $1
          AND j.internship_id = $2
          AND d.domain_name = $3
        `,
        [userId, concept.internship_id, concept.domain_name]
      );

      if (joinedRes.rowCount === 0) {
        return res.status(403).json({ message: "Not allowed to delete files" });
      }
    }

    const deleteRes = await db.query(
      `
      DELETE FROM mentedge.concept_files
      WHERE id = $1 AND concept_id = $2
      RETURNING *
      `,
      [fileId, conceptId]
    );

    if (deleteRes.rowCount === 0) {
      return res.status(404).json({ message: "File not found" });
    }

    return res.status(200).json({
      message: "Concept file deleted",
      file: deleteRes.rows[0],
    });
  } catch (err) {
    console.error("deleteConceptFile error:", err);
    return res.status(500).json({ message: "Failed to delete concept file" });
  }
};

const submitAssignment = async (req, res) => {
  try {
    const internId = req.user?.id;
    const { assignmentId } = req.params;
    const { status, text_content } = req.body;

    if (!internId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const assignmentRes = await db.query(
      `
      SELECT a.id
      FROM mentedge.assignments a
      JOIN mentedge.milestones m ON m.id = a.milestone_id
      JOIN mentedge.workboards w ON w.id = m.workboard_id
      JOIN mentedge.internship_joined j ON j.internship_id = w.internship_id
      JOIN mentedge.internship_domains d
        ON d.id = j.domain_id AND d.domain_name = w.domain_name
      LEFT JOIN mentedge.assignment_assignments aa
        ON aa.assignment_id = a.id AND aa.intern_id = $2
      WHERE a.id = $1
        AND j.intern_id = $2
        AND (
          aa.intern_id IS NOT NULL
          OR NOT EXISTS (
            SELECT 1
            FROM mentedge.assignment_assignments aa2
            WHERE aa2.assignment_id = a.id
          )
        )
      `,
      [assignmentId, internId]
    );

    if (assignmentRes.rowCount === 0) {
      return res.status(404).json({ message: "Assignment not found" });
    }

    if (status === undefined && text_content === undefined) {
      return res.status(400).json({
        message: "Provide status or text_content to submit",
      });
    }

    if (text_content !== undefined && !String(text_content).trim()) {
      return res.status(400).json({ message: "text_content cannot be empty" });
    }

    const normalizedStatus = normalizeAssignmentSubmissionStatus(
      status ?? "submitted"
    );
    const result = await db.query(
      `
      INSERT INTO mentedge.assignment_submissions (
        assignment_id, intern_id, status, text_content, submitted_at, updated_at
      )
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      ON CONFLICT (assignment_id, intern_id)
      DO UPDATE SET
        status = EXCLUDED.status,
        text_content = COALESCE(EXCLUDED.text_content, mentedge.assignment_submissions.text_content),
        submitted_at = NOW(),
        updated_at = NOW()
      RETURNING *
      `,
      [
        assignmentId,
        internId,
        normalizedStatus,
        text_content ?? null,
      ]
    );

    return res.status(200).json({
      message: "Assignment submitted",
      submission: result.rows[0],
    });
  } catch (err) {
    console.error("submitAssignment error:", err);
    return res.status(500).json({ message: "Failed to submit assignment" });
  }
};

const submitAssignmentFiles = async (req, res) => {
  try {
    const internId = req.user?.id;
    const { assignmentId } = req.params;
    const { status } = req.body;
    const files = Array.isArray(req.files) ? req.files : [];

    if (!internId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!assignmentId) {
      return res.status(400).json({ message: "assignmentId is required" });
    }

    if (files.length === 0) {
      return res.status(400).json({ message: "No files uploaded" });
    }

    const assignmentRes = await db.query(
      `
      SELECT a.id
      FROM mentedge.assignments a
      JOIN mentedge.milestones m ON m.id = a.milestone_id
      JOIN mentedge.workboards w ON w.id = m.workboard_id
      JOIN mentedge.internship_joined j ON j.internship_id = w.internship_id
      JOIN mentedge.internship_domains d
        ON d.id = j.domain_id AND d.domain_name = w.domain_name
      LEFT JOIN mentedge.assignment_assignments aa
        ON aa.assignment_id = a.id AND aa.intern_id = $2
      WHERE a.id = $1
        AND j.intern_id = $2
        AND (
          aa.intern_id IS NOT NULL
          OR NOT EXISTS (
            SELECT 1
            FROM mentedge.assignment_assignments aa2
            WHERE aa2.assignment_id = a.id
          )
        )
      `,
      [assignmentId, internId]
    );

    if (assignmentRes.rowCount === 0) {
      return res.status(404).json({ message: "Assignment not found" });
    }

    const normalizedStatus = normalizeAssignmentSubmissionStatus(
      status ?? "submitted"
    );
    const submissionRes = await db.query(
      `
      INSERT INTO mentedge.assignment_submissions (
        assignment_id, intern_id, status, submitted_at, updated_at
      )
      VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT (assignment_id, intern_id)
      DO UPDATE SET
        status = EXCLUDED.status,
        submitted_at = NOW(),
        updated_at = NOW()
      RETURNING *
      `,
      [assignmentId, internId, normalizedStatus]
    );

    const submissionId = submissionRes.rows[0].id;
    const fileUrls = files.map((file) => file.path);
    const fileNames = files.map((file) => file.originalname || file.filename);
    const fileTypes = files.map((file) => file.mimetype);

    const filesRes = await db.query(
      `
      INSERT INTO mentedge.assignment_submission_files (
        submission_id, file_url, file_name, file_type
      )
      SELECT
        $1,
        f.file_url,
        f.file_name,
        f.file_type
      FROM unnest($2::text[], $3::text[], $4::text[]) AS f(file_url, file_name, file_type)
      RETURNING *
      `,
      [submissionId, fileUrls, fileNames, fileTypes]
    );

    return res.status(201).json({
      message: "Assignment files submitted",
      submission: submissionRes.rows[0],
      files: filesRes.rows,
    });
  } catch (err) {
    console.error("submitAssignmentFiles error:", err);
    return res.status(500).json({ message: "Failed to submit files" });
  }
};

const uploadAssignmentFiles = async (req, res) => {
  try {
    const mentorId = req.user?.id;
    const { assignmentId } = req.params;
    const files = Array.isArray(req.files) ? req.files : [];

    if (!mentorId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!assignmentId) {
      return res.status(400).json({ message: "assignmentId is required" });
    }

    if (files.length === 0) {
      return res.status(400).json({ message: "No files uploaded" });
    }

    const assignmentRes = await db.query(
      `
      SELECT a.id
      FROM mentedge.assignments a
      JOIN mentedge.milestones m ON m.id = a.milestone_id
      JOIN mentedge.workboards w ON w.id = m.workboard_id
      WHERE a.id = $1 AND w.created_by = $2
      `,
      [assignmentId, mentorId]
    );

    if (assignmentRes.rowCount === 0) {
      return res.status(404).json({ message: "Assignment not found" });
    }

    const fileUrls = files.map((file) => file.path);
    const fileNames = files.map((file) => file.originalname || file.filename);
    const fileTypes = files.map((file) => file.mimetype);

    const result = await db.query(
      `
      INSERT INTO mentedge.assignment_files (
        assignment_id, file_url, file_name, file_type
      )
      SELECT
        $1,
        f.file_url,
        f.file_name,
        f.file_type
      FROM unnest($2::text[], $3::text[], $4::text[]) AS f(file_url, file_name, file_type)
      RETURNING *
      `,
      [assignmentId, fileUrls, fileNames, fileTypes]
    );

    return res.status(201).json({
      message: "Assignment files uploaded",
      files: result.rows,
    });
  } catch (err) {
    console.error("uploadAssignmentFiles error:", err);
    return res.status(500).json({ message: "Failed to upload assignment files" });
  }
};

const getAssignmentFiles = async (req, res) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;
    const { assignmentId } = req.params;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!assignmentId) {
      return res.status(400).json({ message: "assignmentId is required" });
    }

    const assignmentRes = await db.query(
      `
      SELECT a.id, w.internship_id, w.domain_name, w.created_by
      FROM mentedge.assignments a
      JOIN mentedge.milestones m ON m.id = a.milestone_id
      JOIN mentedge.workboards w ON w.id = m.workboard_id
      WHERE a.id = $1
      `,
      [assignmentId]
    );

    if (assignmentRes.rowCount === 0) {
      return res.status(404).json({ message: "Assignment not found" });
    }

    const assignment = assignmentRes.rows[0];

    if (role === "mentor") {
      if (assignment.created_by !== userId) {
        return res.status(403).json({ message: "Not allowed to view files" });
      }
    } else {
      const joinedRes = await db.query(
        `
        SELECT 1
        FROM mentedge.internship_joined j
        JOIN mentedge.internship_domains d ON d.id = j.domain_id
        WHERE j.intern_id = $1
          AND j.internship_id = $2
          AND d.domain_name = $3
        `,
        [userId, assignment.internship_id, assignment.domain_name]
      );

      if (joinedRes.rowCount === 0) {
        return res.status(403).json({ message: "Not allowed to view files" });
      }
    }

    const result = await db.query(
      `
      SELECT
        id,
        assignment_id,
        file_url,
        file_name,
        file_type,
        created_at
      FROM mentedge.assignment_files
      WHERE assignment_id = $1
      ORDER BY created_at DESC
      `,
      [assignmentId]
    );

    return res.status(200).json(result.rows);
  } catch (err) {
    console.error("getAssignmentFiles error:", err);
    return res.status(500).json({ message: "Failed to fetch assignment files" });
  }
};

const deleteAssignmentFile = async (req, res) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;
    const { assignmentId, fileId } = req.params;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!assignmentId || !fileId) {
      return res
        .status(400)
        .json({ message: "assignmentId and fileId are required" });
    }

    const assignmentRes = await db.query(
      `
      SELECT a.id, w.internship_id, w.domain_name, w.created_by
      FROM mentedge.assignments a
      JOIN mentedge.milestones m ON m.id = a.milestone_id
      JOIN mentedge.workboards w ON w.id = m.workboard_id
      WHERE a.id = $1
      `,
      [assignmentId]
    );

    if (assignmentRes.rowCount === 0) {
      return res.status(404).json({ message: "Assignment not found" });
    }

    const assignment = assignmentRes.rows[0];

    if (role === "mentor") {
      if (assignment.created_by !== userId) {
        return res.status(403).json({ message: "Not allowed to delete files" });
      }
    } else {
      return res.status(403).json({ message: "Not allowed to delete files" });
    }

    const deleteRes = await db.query(
      `
      DELETE FROM mentedge.assignment_files
      WHERE id = $1 AND assignment_id = $2
      RETURNING *
      `,
      [fileId, assignmentId]
    );

    if (deleteRes.rowCount === 0) {
      return res.status(404).json({ message: "File not found" });
    }

    return res.status(200).json({
      message: "Assignment file deleted",
      file: deleteRes.rows[0],
    });
  } catch (err) {
    console.error("deleteAssignmentFile error:", err);
    return res.status(500).json({ message: "Failed to delete assignment file" });
  }
};

const gradeAssignment = async (req, res) => {
  try {
    const mentorId = req.user?.id;
    const { assignmentId } = req.params;
    const { intern_id, status, score, feedback } = req.body;

    if (!mentorId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!intern_id) {
      return res.status(400).json({ message: "intern_id is required" });
    }

    const assignmentRes = await db.query(
      `
      SELECT a.id
      FROM mentedge.assignments a
      JOIN mentedge.milestones m ON m.id = a.milestone_id
      JOIN mentedge.workboards w ON w.id = m.workboard_id
      JOIN mentedge.internship_hosts h
        ON h.internship_id = w.internship_id
       AND h.mentor_id = $2
       AND (
         h.role = 'host'
         OR (
           h.role = 'co-host'
           AND h.invite_status = 'accepted'
           AND h.domain = w.domain_name
         )
       )
      WHERE a.id = $1
      `,
      [assignmentId, mentorId]
    );

    if (assignmentRes.rowCount === 0) {
      return res.status(403).json({ message: "Not allowed to grade" });
    }

    const normalizedStatus = normalizeAssignmentGradeStatus(status);
    const result = await db.query(
      `
      UPDATE mentedge.assignment_submissions
      SET status = $3,
          score = $4,
          feedback = $5,
          graded_at = NOW(),
          updated_at = NOW()
      WHERE assignment_id = $1 AND intern_id = $2
      RETURNING *
      `,
      [assignmentId, intern_id, normalizedStatus, score ?? null, feedback ?? null]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Submission not found" });
    }

    return res.status(200).json({
      message: "Assignment graded",
      submission: result.rows[0],
    });
  } catch (err) {
    console.error("gradeAssignment error:", err);
    return res.status(500).json({ message: "Failed to grade assignment" });
  }
};

const getAvailableInternshipsForIntern = async (req, res) => {
  try {
    const internId = req.user?.id;

    if (!internId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const result = await db.query(
      `
      SELECT
        i.id,
        i.internship_title,
        i.description,
        i.price,
        i.status,
        i.computed_status,
        i.approval_required,
        i.created_at,

        COALESCE((
          SELECT json_object_agg(
            d.domain_name,
            json_build_object(
              'id', d.id,
              'domain_name', d.domain_name,
              'domain_title', d.domain_title,
              'domain_description', d.domain_description,
              'skills_required', d.skills_required,
              'tools_used', d.tools_used,
              'tags', d.tags,
              'weekly_hours', d.weekly_hours,
              'duration', d.duration,
              'start_date', d.start_date,
              'end_date', d.end_date,
              'application_deadline', d.application_deadline,
              'difficulty_level', d.difficulty_level,
              'marketplace_category', d.marketplace_category,
              'max_seats', d.max_seats,
              'join_count', d.join_count,
              'seats_left', d.seats_left
            )
          ) FILTER (WHERE d.id IS NOT NULL)
          FROM mentedge.internship_domains d
          WHERE d.internship_id = i.id
            AND (d.max_seats IS NULL OR d.join_count < d.max_seats)
            AND NOT EXISTS (
              SELECT 1
              FROM mentedge.internship_joined j
              WHERE j.intern_id = $1 AND j.domain_id = d.id
            )
        ), '{}'::json) AS domains,

        COALESCE((
          SELECT json_agg(
            json_build_object(
              'id', m.id,
              'full_name', m.full_name,
              'avatar', m.avatar,
              'role', h.role,
              'domain', h.domain,
              'invite_status', h.invite_status
            )
          )
          FROM mentedge.internship_hosts h
          JOIN mentedge.mentors m ON m.id = h.mentor_id
          WHERE h.internship_id = i.id
            AND h.role = 'host'
        ), '[]'::json) AS host,

        COALESCE((
          SELECT json_agg(
            json_build_object(
              'id', m.id,
              'full_name', m.full_name,
              'avatar', m.avatar,
              'role', h.role,
              'domain', h.domain,
              'invite_status', h.invite_status
            )
          )
          FROM mentedge.internship_hosts h
          JOIN mentedge.mentors m ON m.id = h.mentor_id
          WHERE h.internship_id = i.id
            AND h.role = 'co-host'
        ), '[]'::json) AS co_host
      FROM mentedge.internships_with_computed_status i
      WHERE i.status = 'published'
        AND EXISTS (
          SELECT 1
          FROM mentedge.internship_domains d
          WHERE d.internship_id = i.id
            AND (d.max_seats IS NULL OR d.join_count < d.max_seats)
            AND NOT EXISTS (
              SELECT 1
              FROM mentedge.internship_joined j
              WHERE j.intern_id = $1 AND j.domain_id = d.id
            )
        )
      ORDER BY i.created_at DESC
      `,
      [internId]
    );

    return res.status(200).json(result.rows);
  } catch (err) {
    console.error("getAvailableInternshipsForIntern error:", err);
    return res.status(500).json({ message: "Failed to fetch internships" });
  }
};

const upsertConceptProgress = async (req, res) => {
  try {
    const internId = req.user?.id;
    const { conceptId } = req.params;
    const { status } = req.body;

    if (!internId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const conceptRes = await db.query(
      `
      SELECT c.id
      FROM mentedge.concepts c
      JOIN mentedge.milestones m ON m.id = c.milestone_id
      JOIN mentedge.workboards w ON w.id = m.workboard_id
      JOIN mentedge.internship_joined j ON j.internship_id = w.internship_id
      JOIN mentedge.internship_domains d
        ON d.id = j.domain_id AND d.domain_name = w.domain_name
      WHERE c.id = $1 AND j.intern_id = $2
      `,
      [conceptId, internId]
    );

    if (conceptRes.rowCount === 0) {
      return res.status(404).json({ message: "Concept not found" });
    }

    const normalizedStatus = normalizeConceptProgressStatus(status);
    const result = await db.query(
      `
      INSERT INTO mentedge.concept_progress (
        concept_id, intern_id, status, completed_at, updated_at
      )
      VALUES ($1, $2, $3, CASE WHEN $3 = 'completed' THEN NOW() ELSE NULL END, NOW())
      ON CONFLICT (concept_id, intern_id)
      DO UPDATE SET
        status = EXCLUDED.status,
        completed_at = CASE
          WHEN EXCLUDED.status = 'completed' THEN NOW()
          ELSE NULL
        END,
        updated_at = NOW()
      RETURNING *
      `,
      [conceptId, internId, normalizedStatus]
    );

    return res.status(200).json({
      message: "Concept progress updated",
      progress: result.rows[0],
    });
  } catch (err) {
    console.error("upsertConceptProgress error:", err);
    return res.status(500).json({ message: "Failed to update concept progress" });
  }
};

const upsertTaskProgress = async (req, res) => {
  try {
    const internId = req.user?.id;
    const { taskId } = req.params;
    const { status } = req.body;

    if (!internId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const taskRes = await db.query(
      `
      SELECT t.id
      FROM mentedge.tasks t
      JOIN mentedge.milestones m ON m.id = t.milestone_id
      JOIN mentedge.workboards w ON w.id = m.workboard_id
      JOIN mentedge.internship_joined j ON j.internship_id = w.internship_id
      JOIN mentedge.internship_domains d
        ON d.id = j.domain_id AND d.domain_name = w.domain_name
      LEFT JOIN mentedge.task_assignments ta
        ON ta.task_id = t.id AND ta.intern_id = $2
      WHERE t.id = $1
        AND j.intern_id = $2
        AND (
          ta.intern_id IS NOT NULL
          OR t.assigned_to = $2
          OR NOT EXISTS (
            SELECT 1 FROM mentedge.task_assignments ta2 WHERE ta2.task_id = t.id
          )
        )
      `,
      [taskId, internId]
    );

    if (taskRes.rowCount === 0) {
      return res.status(404).json({ message: "Task not found" });
    }

    const normalizedStatus = normalizeTaskStatus(status);
    const result = await db.query(
      `
      INSERT INTO mentedge.task_progress (
        task_id, intern_id, status, completed_at, updated_at
      )
      VALUES ($1, $2, $3, CASE WHEN $3 = 'done' THEN NOW() ELSE NULL END, NOW())
      ON CONFLICT (task_id, intern_id)
      DO UPDATE SET
        status = EXCLUDED.status,
        completed_at = CASE
          WHEN EXCLUDED.status = 'done' THEN NOW()
          ELSE NULL
        END,
        updated_at = NOW()
      RETURNING *
      `,
      [taskId, internId, normalizedStatus]
    );

    return res.status(200).json({
      message: "Task progress updated",
      progress: result.rows[0],
    });
  } catch (err) {
    console.error("upsertTaskProgress error:", err);
    return res.status(500).json({ message: "Failed to update task progress" });
  }
};

const getInternPerformance = async (req, res) => {
  try {
    const internId = req.user?.id;
    const { internshipId } = req.params;

    if (!internId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!internshipId) {
      return res.status(400).json({ message: "internshipId is required" });
    }

    const domainRes = await db.query(
      `
      SELECT d.domain_name
      FROM mentedge.internship_joined j
      JOIN mentedge.internship_domains d ON d.id = j.domain_id
      WHERE j.intern_id = $1 AND j.internship_id = $2
      `,
      [internId, internshipId]
    );

    if (domainRes.rowCount === 0) {
      return res
        .status(404)
        .json({ message: "Intern not joined to this internship" });
    }

    const workboardRes = await db.query(
      `
      SELECT id
      FROM mentedge.workboards
      WHERE internship_id = $1 AND domain_name = $2
      LIMIT 1
      `,
      [internshipId, domainRes.rows[0].domain_name]
    );

    if (workboardRes.rowCount === 0) {
      return res.status(404).json({ message: "Workboard not found" });
    }

    const workboardId = workboardRes.rows[0].id;
    const statsRes = await db.query(
      `
      WITH milestones AS (
        SELECT id FROM mentedge.milestones WHERE workboard_id = $1
      ),
      concepts AS (
        SELECT c.id
        FROM mentedge.concepts c
        JOIN milestones m ON m.id = c.milestone_id
      ),
      tasks AS (
        SELECT t.id, t.assigned_to
        FROM mentedge.tasks t
        JOIN milestones m ON m.id = t.milestone_id
      ),
      assignments AS (
        SELECT a.id
        FROM mentedge.assignments a
        JOIN milestones m ON m.id = a.milestone_id
      ),
      task_assigned AS (
        SELECT DISTINCT t.id
        FROM tasks t
        LEFT JOIN mentedge.task_assignments ta
          ON ta.task_id = t.id AND ta.intern_id = $2
        WHERE ta.intern_id IS NOT NULL
          OR t.assigned_to = $2
          OR NOT EXISTS (
            SELECT 1 FROM mentedge.task_assignments ta2 WHERE ta2.task_id = t.id
          )
      ),
      assignment_assigned AS (
        SELECT DISTINCT a.id
        FROM assignments a
        LEFT JOIN mentedge.assignment_assignments aa
          ON aa.assignment_id = a.id AND aa.intern_id = $2
        WHERE aa.intern_id IS NOT NULL
          OR NOT EXISTS (
            SELECT 1
            FROM mentedge.assignment_assignments aa2
            WHERE aa2.assignment_id = a.id
          )
      )
      SELECT
        (SELECT COUNT(*) FROM concepts) AS concepts_total,
        (SELECT COUNT(*)
         FROM concepts c
         JOIN mentedge.concept_progress cp
           ON cp.concept_id = c.id AND cp.intern_id = $2
         WHERE cp.status = 'completed'
        ) AS concepts_completed,
        (SELECT COUNT(*) FROM tasks) AS tasks_total,
        (SELECT COUNT(*) FROM task_assigned) AS tasks_assigned,
        (SELECT COUNT(*)
         FROM task_assigned ta
         JOIN mentedge.task_progress tp
           ON tp.task_id = ta.id AND tp.intern_id = $2
         WHERE tp.status = 'done'
        ) AS tasks_completed,
        (SELECT COUNT(*) FROM assignments) AS assignments_total,
        (SELECT COUNT(*) FROM assignment_assigned) AS assignments_assigned,
        (SELECT COUNT(*)
         FROM assignments a
         JOIN mentedge.assignment_submissions s
           ON s.assignment_id = a.id AND s.intern_id = $2
         WHERE s.status <> 'not_started'
        ) AS assignments_submitted,
        (SELECT COUNT(*)
         FROM assignments a
         JOIN mentedge.assignment_submissions s
           ON s.assignment_id = a.id AND s.intern_id = $2
         WHERE s.status = 'graded'
        ) AS assignments_graded
      `,
      [workboardId, internId]
    );

    return res.status(200).json(statsRes.rows[0]);
  } catch (err) {
    console.error("getInternPerformance error:", err);
    return res.status(500).json({ message: "Failed to fetch performance" });
  }
};

/* ===========================
   CREATE internship (with domain rows)
   =========================== */
const createInternship = async (req, res) => {
  const client = await db.connect();
  try {
    const {
      internship_title,
      description,
      price,
      approval_required,
      host_domain,
      co_host_id,
      tech,
      management,
    } = req.body;

    if (!internship_title || !host_domain) {
      return res
        .status(400)
        .json({ message: "internship_title and host_domain are required" });
    }

    if (host_domain !== "tech" && host_domain !== "management") {
      return res
        .status(400)
        .json({ message: "host_domain must be 'tech' or 'management'" });
    }

    const domainData = host_domain === "tech" ? tech : management;
    if (!domainData) {
      return res
        .status(400)
        .json({ message: `Missing ${host_domain} domain details` });
    }

    const mentorId = req.user.id; // logged in mentor
    const status = co_host_id ? "submitted" : "draft";
    const priceValue = price ?? 0;
    const approvalRequiredValue = approval_required ?? false;
    const domainDescription =
      domainData.domain_description ?? domainData.description ?? null;
    const domainTitle = domainData.domain_title ?? domainData.title ?? null;
    const domainName = domainData.domain_name ?? host_domain;
    const skillsRequired =
      domainData.skills_required ?? domainData.skills ?? null;
    const toolsUsed = domainData.tools_used ?? null;
    const tags = domainData.tags ?? null;
    const certificateProvided = domainData.certificate_provided ?? false;

    await client.query("BEGIN");

    const internshipResult = await client.query(
      `
      INSERT INTO mentedge.internships (
        internship_title, description, price,
        approval_required, created_by, status
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
      `,
      [
        internship_title,
        description ?? null,
        priceValue,
        approvalRequiredValue,
        mentorId,
        status,
      ]
    );

    const internshipId = internshipResult.rows[0].id;

    await client.query(
      `
      INSERT INTO mentedge.internship_hosts (
        internship_id, mentor_id, role, domain, invite_status
      )
      VALUES ($1, $2, 'host', $3, 'accepted')
      `,
      [internshipId, mentorId, host_domain]
    );

    if (co_host_id) {
      await client.query(
        `
        INSERT INTO mentedge.internship_hosts (
          internship_id, mentor_id, role, domain, invite_status
        )
        VALUES ($1, $2, 'co-host', $3, 'pending')
        `,
        [
          internshipId,
          co_host_id,
          host_domain === "tech" ? "management" : "tech",
        ]
      );
    }

    await client.query(
      `
      INSERT INTO mentedge.internship_domains (
        internship_id, domain_description,
        skills_required, tools_used, tags, domain_title,
        start_date, end_date, application_deadline,
        weekly_hours, duration, difficulty_level, marketplace_category, domain_name, max_seats,
        certificate_provided
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
      )
      `,
      [
        internshipId,
        domainDescription,
        safeJson(skillsRequired),
        safeJson(toolsUsed),
        safeJson(tags),
        domainTitle,
        domainData.start_date ?? null,
        domainData.end_date ?? null,
        domainData.application_deadline ?? null,
        domainData.weekly_hours ?? null,
        domainData.duration ?? null,
        domainData.difficulty_level ?? null,
        domainData.marketplace_category ?? null,
        domainName,
        domainData.max_seats ?? null,
        certificateProvided,
      ]
    );

    await client.query(
      `
      INSERT INTO mentedge.workboards (
        internship_id, domain_name, created_by, title
      )
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (internship_id, domain_name) DO NOTHING
      `,
      [
        internshipId,
        domainName,
        mentorId,
        `${internship_title} - ${domainName}`,
      ]
    );

    await client.query("COMMIT");

    res.status(201).json({
      message: "Internship created",
      internship_id: internshipId,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ message: "Failed to create internship" });
  } finally {
    client.release();
  }
};

/* ===========================
   GET ALL internships (with domains)
   =========================== */
const getAllInternships = async (req, res) => {
  try {
    const result = await pool.query(`
      ${BASE_SELECT_WITH_DOMAINS}
      GROUP BY i.id
      ORDER BY i.id DESC
    `);
    return res.status(200).json(result.rows);
  } catch (err) {
    console.error("getAllInternships error:", err);
    return res.status(500).json({ error: "Failed to fetch internships" });
  }
};

const getCurrentMentorInternships = async (req, res) => {
  try {
    const mentorId = req.user.id;
    const getCurrentMentorInternshipsQuery = `SELECT 
  i.id,
  i.internship_title,
  i.description,
  i.price,
  i.status,
  i.computed_status,
  i.approval_required,
  i.created_at,

  COALESCE((
    SELECT json_object_agg(
      d.domain_name,
      json_build_object(
        'domain_name', d.domain_name,
        'domain_description', d.domain_description,
        'skills_required', d.skills_required,
        'tools_used', d.tools_used,
        'tags', d.tags,
        'weekly_hours', d.weekly_hours,
        'duration', d.duration,
        'start_date', d.start_date,
        'end_date', d.end_date,
        'application_deadline', d.application_deadline,
        'difficulty_level', d.difficulty_level,
        'marketplace_category', d.marketplace_category,
        'max_seats', d.max_seats,
        'join_count', d.join_count,
        'seats_left', d.seats_left
      )
    ) FILTER (WHERE d.id IS NOT NULL)
    FROM mentedge.internship_domains d
    WHERE d.internship_id = i.id
  ), '{}'::json) AS domains,

  -- my role
  (
    SELECT json_build_object(
      'role', h.role,
      'domain', h.domain,
      'invite_status', h.invite_status
    )
    FROM mentedge.internship_hosts h
    WHERE h.internship_id = i.id
      AND h.mentor_id = $1
  ) AS my_role,

  -- host
  COALESCE((
    SELECT json_agg(
      json_build_object(
        'id', m.id,
        'full_name', m.full_name,
        'avatar', m.avatar,
        'role', h.role,
        'domain', h.domain,
        'invite_status', h.invite_status
      )
    )
    FROM mentedge.internship_hosts h
    JOIN mentedge.mentors m ON m.id = h.mentor_id
    WHERE h.internship_id = i.id
      AND h.role = 'host'
  ), '[]'::json) AS host,

  -- co-host
  COALESCE((
    SELECT json_agg(
      json_build_object(
        'id', m.id,
        'full_name', m.full_name,
        'avatar', m.avatar,
        'role', h.role,
        'domain', h.domain,
        'invite_status', h.invite_status
      )
    )
    FROM mentedge.internship_hosts h
    JOIN mentedge.mentors m ON m.id = h.mentor_id
    WHERE h.internship_id = i.id
      AND h.role = 'co-host'
  ), '[]'::json) AS co_host

FROM mentedge.internships_with_computed_status i
WHERE EXISTS (
  SELECT 1
  FROM mentedge.internship_hosts h
  WHERE h.internship_id = i.id
    AND h.mentor_id = $1 AND h.role = 'host'
)
ORDER BY i.created_at DESC;
`;

    const result = await db.query({
      text: getCurrentMentorInternshipsQuery,
      values: [mentorId],
    });
    return res.status(200).json(result.rows);
  } catch (err) {
    console.error("getCurrentMentorInternships error:", err);
    return res.status(500).json({ error: "Failed to fetch internships" });
  }
};

const getScheduledMentorInternships = async (req, res) => {
  try {
    const mentorId = req.user.id;
    const query = `SELECT
  i.id,
  i.internship_title,
  i.description,
  i.price,
  i.status,
  i.computed_status,
  i.approval_required,
  i.created_at,

  COALESCE((
    SELECT json_object_agg(
      d.domain_name,
      json_build_object(
        'domain_name', d.domain_name,
        'domain_description', d.domain_description,
        'skills_required', d.skills_required,
        'tools_used', d.tools_used,
        'tags', d.tags,
        'weekly_hours', d.weekly_hours,
        'duration', d.duration,
        'start_date', d.start_date,
        'end_date', d.end_date,
        'application_deadline', d.application_deadline,
        'difficulty_level', d.difficulty_level,
        'marketplace_category', d.marketplace_category,
        'max_seats', d.max_seats,
        'join_count', d.join_count,
        'seats_left', d.seats_left
      )
    ) FILTER (WHERE d.id IS NOT NULL)
    FROM mentedge.internship_domains d
    WHERE d.internship_id = i.id
      AND d.start_date IS NOT NULL
      AND d.start_date > CURRENT_DATE
      AND (d.application_deadline IS NULL OR d.application_deadline < CURRENT_DATE)
  ), '{}'::json) AS domains,

  (
    SELECT json_build_object(
      'role', h.role,
      'domain', h.domain
    )
    FROM mentedge.internship_hosts h
    WHERE h.internship_id = i.id
      AND h.mentor_id = $1
  ) AS my_role,

  COALESCE((
    SELECT json_agg(
      json_build_object(
        'id', m.id,
        'full_name', m.full_name,
        'avatar', m.avatar,
        'role', h.role,
        'domain', h.domain,
        'invite_status', h.invite_status
      )
    )
    FROM mentedge.internship_hosts h
    JOIN mentedge.mentors m ON m.id = h.mentor_id
    WHERE h.internship_id = i.id
      AND h.role = 'host'
  ), '[]'::json) AS host,

  COALESCE((
    SELECT json_agg(
      json_build_object(
        'id', m.id,
        'full_name', m.full_name,
        'avatar', m.avatar,
        'role', h.role,
        'domain', h.domain,
        'invite_status', h.invite_status
      )
    )
    FROM mentedge.internship_hosts h
    JOIN mentedge.mentors m ON m.id = h.mentor_id
    WHERE h.internship_id = i.id
      AND h.role = 'co-host'
  ), '[]'::json) AS co_host

FROM mentedge.internships_with_computed_status i
WHERE EXISTS (
  SELECT 1
  FROM mentedge.internship_hosts h
  WHERE h.internship_id = i.id
    AND h.mentor_id = $1
    AND (
      h.role = 'host'
      OR (h.role = 'co-host' AND h.invite_status = 'accepted')
    )
)
AND EXISTS (
  SELECT 1
  FROM mentedge.internship_domains d
  WHERE d.internship_id = i.id
    AND d.start_date IS NOT NULL
    AND d.start_date > CURRENT_DATE
    AND (d.application_deadline IS NULL OR d.application_deadline < CURRENT_DATE)
)
ORDER BY i.created_at DESC;
`;

    const result = await db.query({
      text: query,
      values: [mentorId],
    });
    return res.status(200).json(result.rows);
  } catch (err) {
    console.error("getScheduledMentorInternships error:", err);
    return res.status(500).json({ error: "Failed to fetch internships" });
  }
};

const getOngoingMentorInternships = async (req, res) => {
  try {
    const mentorId = req.user.id;
    const query = `SELECT
  i.id,
  i.internship_title,
  i.description,
  i.price,
  i.status,
  i.computed_status,
  i.approval_required,
  i.created_at,

  COALESCE((
    SELECT json_object_agg(
      d.domain_name,
      json_build_object(
        'domain_name', d.domain_name,
        'domain_description', d.domain_description,
        'skills_required', d.skills_required,
        'tools_used', d.tools_used,
        'tags', d.tags,
        'weekly_hours', d.weekly_hours,
        'duration', d.duration,
        'start_date', d.start_date,
        'end_date', d.end_date,
        'application_deadline', d.application_deadline,
        'difficulty_level', d.difficulty_level,
        'marketplace_category', d.marketplace_category,
        'max_seats', d.max_seats,
        'join_count', d.join_count,
        'seats_left', d.seats_left
      )
    ) FILTER (WHERE d.id IS NOT NULL)
    FROM mentedge.internship_domains d
    WHERE d.internship_id = i.id
      AND d.start_date IS NOT NULL
      AND d.end_date IS NOT NULL
      AND CURRENT_DATE BETWEEN d.start_date AND d.end_date
  ), '{}'::json) AS domains,

  (
    SELECT json_build_object(
      'role', h.role,
      'domain', h.domain,
      'invite_status', h.invite_status
    )
    FROM mentedge.internship_hosts h
    WHERE h.internship_id = i.id
      AND h.mentor_id = $1
  ) AS my_role,

  COALESCE((
    SELECT json_agg(
      json_build_object(
        'id', m.id,
        'full_name', m.full_name,
        'avatar', m.avatar,
        'role', h.role,
        'domain', h.domain,
        'invite_status', h.invite_status
      )
    )
    FROM mentedge.internship_hosts h
    JOIN mentedge.mentors m ON m.id = h.mentor_id
    WHERE h.internship_id = i.id
      AND h.role = 'host'
  ), '[]'::json) AS host,

  COALESCE((
    SELECT json_agg(
      json_build_object(
        'id', m.id,
        'full_name', m.full_name,
        'avatar', m.avatar,
        'role', h.role,
        'domain', h.domain,
        'invite_status', h.invite_status
      )
    )
    FROM mentedge.internship_hosts h
    JOIN mentedge.mentors m ON m.id = h.mentor_id
    WHERE h.internship_id = i.id
      AND h.role = 'co-host'
  ), '[]'::json) AS co_host

FROM mentedge.internships_with_computed_status i
WHERE EXISTS (
  SELECT 1
  FROM mentedge.internship_hosts h
  WHERE h.internship_id = i.id
    AND h.mentor_id = $1
    AND (
      h.role = 'host'
      OR (h.role = 'co-host' AND h.invite_status = 'accepted')
    )
)
AND EXISTS (
  SELECT 1
  FROM mentedge.internship_domains d
  WHERE d.internship_id = i.id
    AND d.start_date IS NOT NULL
    AND d.end_date IS NOT NULL
    AND CURRENT_DATE BETWEEN d.start_date AND d.end_date
)
ORDER BY i.created_at DESC;
`;

    const result = await db.query({
      text: query,
      values: [mentorId],
    });
    return res.status(200).json(result.rows);
  } catch (err) {
    console.error("getOngoingMentorInternships error:", err);
    return res.status(500).json({ error: "Failed to fetch internships" });
  }
};

const getCurrentRequestedInternships = async (req, res) => {
  try {
    const query = `
      SELECT 
        i.id,
        i.internship_title,
        i.description,
        i.price,
        i.status,
        i.computed_status,
        i.approval_required,
        i.created_at,

        -- domains
        COALESCE((
          SELECT json_object_agg(
            d.domain_name,
            json_build_object(
              'domain_name', d.domain_name,
              'description', d.domain_description,
              'skills_required', d.skills_required,
              'tools_used', d.tools_used,
              'tags', d.tags,
              'weekly_hours', d.weekly_hours,
              'duration', d.duration,
              'start_date', d.start_date,
              'end_date', d.end_date,
              'application_deadline', d.application_deadline,
              'difficulty_level', d.difficulty_level,
              'marketplace_category', d.marketplace_category,
              'max_seats', d.max_seats,
              'join_count', d.join_count,
              'seats_left', d.seats_left
            )
          ) FILTER (WHERE d.id IS NOT NULL)
          FROM mentedge.internship_domains d
          WHERE d.internship_id = i.id
        ), '{}'::json) AS domains,

        -- my role
        (
          SELECT json_build_object(
            'role', h.role,
            'domain', h.domain,
            'invite_status', h.invite_status
          )
          FROM mentedge.internship_hosts h
          WHERE h.internship_id = i.id
            AND h.mentor_id = $1
        ) AS my_role,

        -- host
        COALESCE((
          SELECT json_agg(
            json_build_object(
              'id', m.id,
              'full_name', m.full_name,
              'avatar', m.avatar,
              'role', h.role,
              'domain', h.domain,
              'invite_status', h.invite_status
            )
          )
          FROM mentedge.internship_hosts h
          JOIN mentedge.mentors m ON m.id = h.mentor_id
          WHERE h.internship_id = i.id
            AND h.role = 'host'
        ), '[]'::json) AS host,

        -- co-host
        COALESCE((
          SELECT json_agg(
            json_build_object(
              'id', m.id,
              'full_name', m.full_name,
              'avatar', m.avatar,
              'role', h.role,
              'domain', h.domain,
              'invite_status', h.invite_status
            )
          )
          FROM mentedge.internship_hosts h
          JOIN mentedge.mentors m ON m.id = h.mentor_id
          WHERE h.internship_id = i.id
            AND h.role = 'co-host'
        ), '[]'::json) AS co_host

      FROM mentedge.internships_with_computed_status i
      JOIN mentedge.internship_hosts h
        ON h.internship_id = i.id

      WHERE h.mentor_id = $1
        AND h.role = 'co-host'
        AND i.status IN ('draft', 'submitted')

      ORDER BY i.created_at DESC;
    `;

    const result = await db.query(query, [req.user.id]);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error("getCurrentRequestedInternships error:", err);
    res.status(500).json({ error: "Failed to fetch internships" });
  }
};

const submitCohostDomain = async (req, res) => {
  const client = await db.connect();
  try {
    const mentorId = req.user.id;
    const { internshipId } = req.params;
    const domain = req.body;

    if (!domain) {
      return res.status(400).json({ error: "Domain data is required" });
    }

    await client.query("BEGIN");

    // 1️⃣ Verify this user is co-host of this internship
    const roleCheck = await client.query(
      `
      SELECT role, domain, invite_status
      FROM mentedge.internship_hosts
      WHERE internship_id = $1 AND mentor_id = $2
      `,
      [internshipId, mentorId]
    );

    if (roleCheck.rowCount === 0) {
      throw new Error("Not part of this internship");
    }

    const myRole = roleCheck.rows[0];

    if (myRole.role !== "co-host") {
      throw new Error("Only co-host can submit this");
    }

    if (myRole.invite_status === "rejected") {
      throw new Error("Invite was rejected");
    }

    await client.query(
      `
      UPDATE mentedge.internship_hosts
      SET invite_status = 'accepted'
      WHERE internship_id = $1 AND mentor_id = $2
      `,
      [internshipId, mentorId]
    );

    const internshipRes = await client.query(
      `
      SELECT internship_title
      FROM mentedge.internships
      WHERE id = $1
      `,
      [internshipId]
    );

    const internshipTitle = internshipRes.rows[0]?.internship_title;

    // 2️⃣ Ensure domain does not already exist
    const exists = await client.query(
      `
      SELECT 1 FROM mentedge.internship_domains
      WHERE internship_id = $1 AND domain_name = $2
      `,
      [internshipId, myRole.domain]
    );
    console.log(exists.rowCount);
    if (exists.rowCount > 0) {
      throw new Error("Domain already submitted");
    }

    const domainDescription =
      domain.domain_description ?? domain.description ?? null;
    const domainTitle = domain.domain_title ?? domain.title ?? null;
    const skillsRequired = safeJson(domain.skills_required) ?? domain.skills ?? null;
    const toolsUsed = safeJson(domain.tools_used) ?? null;
    const tags = safeJson(domain.tags) ?? null;
    const certificateProvided = domain.certificate_provided ?? false;

    // 3️⃣ Insert co-host domain
    await client.query(
      `
      INSERT INTO mentedge.internship_domains (
        internship_id, domain_name, domain_description,
        skills_required, tools_used, tags, domain_title,
        start_date, end_date, application_deadline,
        weekly_hours, duration, difficulty_level, marketplace_category, max_seats,
        certificate_provided
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
      )
      `,
      [
        internshipId,
        myRole.domain,
        domainDescription,
        skillsRequired,
        toolsUsed,
        tags,
        domainTitle,
        domain.start_date ?? null,
        domain.end_date ?? null,
        domain.application_deadline ?? null,
        domain.weekly_hours ?? null,
        domain.duration ?? null,
        domain.difficulty_level ?? null,
        domain.marketplace_category ?? null,
        domain.max_seats ?? null,
        certificateProvided,
      ]
    );

    if (internshipTitle) {
      await client.query(
        `
        INSERT INTO mentedge.workboards (
          internship_id, domain_name, created_by, title
        )
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (internship_id, domain_name) DO NOTHING
        `,
        [
          internshipId,
          myRole.domain,
          mentorId,
          `${internshipTitle} - ${myRole.domain}`,
        ]
      );
    }

    // 4️⃣ Publish internship now that both domains exist
    await client.query(
      `
      UPDATE mentedge.internships
      SET status = 'submitted'
      WHERE id = $1
      `,
      [internshipId]
    );

    await client.query("COMMIT");

    res.json({
      message:
        "Domain submitted successfully. Internship is ready for approval.",
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
};

const respondCohostInvite = async (req, res) => {
  const client = await db.connect();
  try {
    const { internshipId } = req.params;
    const status  = req.body.status || "rejected";
    const mentorId = req.user?.id;

    if (!mentorId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (status !== "accepted" && status !== "rejected") {
      return res
        .status(400)
        .json({ message: "status must be 'accepted' or 'rejected'" });
    }

    await client.query("BEGIN");

    const roleCheck = await client.query(
      `
      SELECT role, invite_status
      FROM mentedge.internship_hosts
      WHERE internship_id = $1 AND mentor_id = $2
      `,
      [internshipId, mentorId]
    );

    if (roleCheck.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Invite not found" });
    }

    const { role, invite_status } = roleCheck.rows[0];
    if (role !== "co-host") {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "Only co-host can respond" });
    }

    if (invite_status === status) {
      await client.query("ROLLBACK");
      return res.status(200).json({
        message: `Invite already ${status}`,
      });
    }

    if (invite_status !== "pending") {
      await client.query("ROLLBACK");
      return res.status(409).json({
        message: "Invite already responded",
      });
    }

    const result = await client.query(
      `
      UPDATE mentedge.internship_hosts
      SET invite_status = $1
      WHERE internship_id = $2 AND mentor_id = $3
      RETURNING internship_id, mentor_id, role, domain, invite_status
      `,
      [status, internshipId, mentorId]
    );

    await client.query("COMMIT");
    return res.json({
      message: `Invite ${status}`,
      invite: result.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("respondCohostInvite error:", err);
    return res.status(500).json({ message: "Failed to respond to invite" });
  } finally {
    client.release();
  }
};

const approveAndPost = async (req, res) => {
  const client = await db.connect();
  try {
    const { internshipId } = req.params;
    const mentorId = req.user.id;

    await client.query("BEGIN");

    const hostCheck = await client.query(
      `
      SELECT 1
      FROM mentedge.internship_hosts
      WHERE internship_id = $1 AND mentor_id = $2 AND role = 'host'
      `,
      [internshipId, mentorId]
    );

    if (hostCheck.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "Only host can publish" });
    }

    const cohostCount = await client.query(
      `
      SELECT COUNT(*)::int AS cohost_count
      FROM mentedge.internship_hosts
      WHERE internship_id = $1 AND role = 'co-host'
      `,
      [internshipId]
    );

    const domainCount = await client.query(
      `
      SELECT COUNT(DISTINCT domain_name)::int AS domain_count
      FROM mentedge.internship_domains
      WHERE internship_id = $1
      `,
      [internshipId]
    );

    const requiresBothDomains = cohostCount.rows[0].cohost_count > 0;
    const expectedDomains = requiresBothDomains ? 2 : 1;

    if (domainCount.rows[0].domain_count < expectedDomains) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        message: "Both domain details must be submitted before publishing",
      });
    }

    const result = await client.query(
      `
      UPDATE mentedge.internships
      SET status = 'published'
      WHERE id = $1
      RETURNING *
      `,
      [internshipId]
    );

    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Internship not found" });
    }

    await client.query("COMMIT");
    return res.json({
      message: "Accepted & posted",
      internship: result.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("acceptAndPost error:", err);
    return res.status(500).json({ error: "Failed to accept and post" });
  } finally {
    client.release();
  }
};

/* ===========================
   GET internship by id (with domains)
   =========================== */
const getInternshipById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `
      ${BASE_SELECT_WITH_DOMAINS}
      WHERE i.id = $1
      GROUP BY i.id
      LIMIT 1
    `,
      [id]
    );

    if (result.rowCount === 0)
      return res.status(404).json({ message: "Internship not found" });
    return res.json(result.rows[0]);
  } catch (err) {
    console.error("getInternshipById error:", err);
    return res.status(500).json({ error: "Failed to fetch internship" });
  }
};

/* ===========================
   UPDATE internship (main + domains)
   - Expects optional `domains` array:
     each domain object may include `id` (to update) or no id (to insert new)
   - If updating limit_value, we adjust seats_left = limit_value - join_count (preserving join_count)
   =========================== */
const updateInternship = async (req, res) => {
  const mentorId = req.user.id;
  const { internshipId } = req.params;

  const {
    internship_title,
    description,
    price,
    approval_required,
    host_domain,
    co_host_id,
    tech,
    management,
  } = req.body;

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // 1️⃣ Find this mentor’s role + domain
    const roleRes = await client.query(
      `
      SELECT h.role, h.domain, i.status
      FROM mentedge.internship_hosts h
      JOIN mentedge.internships i ON i.id = h.internship_id
      WHERE h.internship_id = $1 AND h.mentor_id = $2
      `,
      [internshipId, mentorId]
    );

    if (roleRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "Not part of this internship" });
    }

    const { role, domain, status } = roleRes.rows[0];

    if (status === "published") {
      await client.query("ROLLBACK");
      return res
        .status(403)
        .json({ message: "Published internships cannot be edited" });
    }

    // 2️⃣ Host can edit master fields
    if (role === "host") {
      await client.query(
        `
        UPDATE mentedge.internships
        SET internship_title = $1,
            description = $2,
            price = $3,
            approval_required = $4
        WHERE id = $5
        `,
        [
          internship_title ?? null,
          description ?? null,
          price ?? 0,
          approval_required ?? false,
          internshipId,
        ]
      );

      if (co_host_id) {
        await client.query(
          `
        INSERT INTO mentedge.internship_hosts (
          internship_id, mentor_id, role, domain, invite_status
        )
        VALUES ($1, $2, 'co-host', $3, 'pending')
        ON CONFLICT (internship_id, mentor_id) DO NOTHING
        `,
          [
            internshipId,
            co_host_id,
            host_domain === "tech" ? "management" : "tech",
          ]
        );
      }
    }

    // 3️⃣ Update domain (only own domain)
    const domainData = domain === "tech" ? tech : management;

    if (!domainData) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Domain data missing" });
    }

    const domainDescription =
      domainData.domain_description ?? domainData.description ?? null;
    const domainTitle = domainData.domain_title ?? domainData.title ?? null;
    const skillsRequired =
      domainData.skills_required ?? domainData.skills ?? null;
    const toolsUsed = domainData.tools_used ?? null;
    const tags = domainData.tags ?? null;
    const certificateProvided = domainData.certificate_provided ?? false;

    await client.query(
      `
      UPDATE mentedge.internship_domains
      SET
        domain_description = $1,
        skills_required = $2,
        tools_used = $3,
        tags = $4,
        domain_title = $5,
        start_date = $6,
        end_date = $7,
        application_deadline = $8,
        weekly_hours = $9,
        duration = $10,
        difficulty_level = $11,
        marketplace_category = $12,
        max_seats = $13,
        certificate_provided = $14
      WHERE internship_id = $15 AND domain_name = $16
      `,
      [
        domainDescription,
        safeJson(skillsRequired),
        safeJson(toolsUsed),
        safeJson(tags),
        domainTitle,
        domainData.start_date ?? null,
        domainData.end_date ?? null,
        domainData.application_deadline ?? null,
        domainData.weekly_hours ?? null,
        domainData.duration ?? null,
        domainData.difficulty_level ?? null,
        domainData.marketplace_category ?? null,
        domainData.max_seats ?? null,
        certificateProvided,
        internshipId,
        domain,
      ]
    );

    await client.query("COMMIT");

    res.json({ message: "Internship updated successfully" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ message: "Failed to update internship" });
  } finally {
    client.release();
  }
};

/* ===========================
   DELETE internship
   =========================== */
const deleteInternship = async (req, res) => {
  const mentorId = req.user.id;
  const { internshipId } = req.params;

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // 1️⃣ Check if this mentor is HOST of this internship
    const check = await client.query(
      `
      SELECT role 
      FROM mentedge.internship_hosts
      WHERE internship_id = $1 AND mentor_id = $2
      `,
      [internshipId, mentorId]
    );

    if (check.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "Not part of this internship" });
    }

    if (check.rows[0].role !== "host") {
      await client.query("ROLLBACK");
      return res
        .status(403)
        .json({ message: "Only host can delete internship" });
    }

    // 2️⃣ Delete internship (CASCADE deletes domains + hosts)
    const deleteResult = await client.query(
      `
      DELETE FROM mentedge.internships
      WHERE id = $1
      `,
      [internshipId]
    );

    if (deleteResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Internship not found" });
    }

    await client.query("COMMIT");

    res.json({ message: "Internship deleted successfully" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ message: "Failed to delete internship" });
  } finally {
    client.release();
  }
};

const getInternshipsByStatus = async (req, res) => {
  try {
    const { status } = req.params;
    const result = await db.query(
      "SELECT * FROM mentedge.internships_with_computed_status WHERE computed_status = $1;",
      [status]
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("getInternshipsByStatus error:", err);
    return res.status(500).json({ error: "Failed to fetch internships" });
  }
};

/* ===========================
   Open for Co-host (workflow)
   =========================== */
const openForCohost = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "UPDATE mentor.internships SET status = 'pending_cohost' WHERE id = $1 RETURNING *",
      [id]
    );
    if (result.rowCount === 0)
      return res.status(404).json({ message: "Internship not found" });
    return res.json({
      message: "Opened for co-host",
      internship: result.rows[0],
    });
  } catch (err) {
    console.error("openForCohost error:", err);
    return res.status(500).json({ error: "Failed to open for co-host" });
  }
};

/* ===========================
   Approve & Post
   =========================== */

/* ===========================
   sendToHost (cohost edits a domain or main fields and sends back)
   - If body contains domain_id => update that domain and mark internship status updated_by_cohost
   - else update main internship small_details/status
   =========================== */
/* ===========================
   sendToHost (CO-HOST FLOW)
   =========================== */
const sendToHost = async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params; // internship id

    // ✅ destructure using snake_case (matches frontend + DB)
    const {
      domain_id,
      hours,
      small_details,
      view_details,
      start_date,
      end_date,
      limit_value,
    } = req.body;

    await client.query("BEGIN");

    /* ===========================
       DOMAIN UPDATE (CO-HOST)
       =========================== */
    if (domain_id) {
      // 1️⃣ Fetch join_count safely
      const dRes = await client.query(
        `SELECT join_count FROM mentor.internship_domains WHERE id = $1 FOR UPDATE`,
        [domain_id]
      );

      if (dRes.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Domain not found" });
      }

      const joinCount = Number(dRes.rows[0].join_count || 0);

      // 2️⃣ Parse & validate limit_value (🔥 FIXES YOUR ERROR)
      const parsedLimit =
        limit_value === undefined || limit_value === null || limit_value === ""
          ? null
          : Number(limit_value);

      if (parsedLimit !== null && Number.isNaN(parsedLimit)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "Invalid limit_value" });
      }

      if (parsedLimit !== null && parsedLimit < joinCount) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message: "limit_value cannot be less than existing join_count",
        });
      }

      // 3️⃣ Update domain safely
      const updateDomain = await client.query(
        `UPDATE mentor.internship_domains
   SET
     hours = $1,
     view_details = $2,
     start_date = $3,
     end_date = $4,
     duration = $5,
     limit_value = $6::INTEGER,
     seats_left = CASE
       WHEN $6::INTEGER IS NOT NULL THEN ($6::INTEGER - join_count)
       ELSE seats_left
     END
   WHERE id = $7
   RETURNING *`,
        [
          hours || null,
          view_details || null,
          start_date || null,
          end_date || null,
          null, // duration
          parsedLimit, // INTEGER or NULL
          domain_id,
        ]
      );

      // 4️⃣ Mark internship as updated_by_cohost
      await client.query(
        `UPDATE mentor.internships
         SET status = 'updated_by_cohost'
         WHERE id = $1`,
        [id]
      );

      await client.query("COMMIT");
      return res.json({
        message: "Domain updated by co-host",
        domain: updateDomain.rows[0],
      });
    }

    /* ===========================
       MAIN INTERNSHIP UPDATE
       (small_details only)
       =========================== */
    const updateMain = await client.query(
      `UPDATE mentor.internships
       SET small_details = $1,
           status = 'updated_by_cohost'
       WHERE id = $2
       RETURNING *`,
      [small_details || null, id]
    );

    if (updateMain.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Internship not found" });
    }

    await client.query("COMMIT");
    return res.json({
      message: "Internship updated by co-host",
      internship: updateMain.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("sendToHost error:", err);
    return res.status(500).json({ error: "Failed to send to host" });
  } finally {
    client.release();
  }
};

/* ===========================
   GET internships by filter (returns domains array too)
   =========================== */
const getInternshipsByFilter = async (req, res) => {
  try {
    const { filter } = req.params;
    let whereClause = "";
    if (filter === "open") {
      whereClause = "WHERE i.status IN ('pending_cohost','cohost')";
    } else if (filter === "sent") {
      whereClause = "WHERE i.status IN ('updated_by_cohost','draft')";
    } else if (filter === "approved") {
      whereClause = "WHERE i.status IN ('posted','published')";
    }

    const result = await pool.query(`
      ${BASE_SELECT_WITH_DOMAINS}
      ${whereClause}
      GROUP BY i.id
      ORDER BY i.id DESC
    `);

    return res.status(200).json(result.rows);
  } catch (err) {
    console.error("getInternshipsByFilter error:", err);
    return res.status(500).json({ error: "Failed to fetch internships" });
  }
};

/* ===========================
   DOMAIN-WISE JOIN (preferred domain)
   - Expects: { internship_id, domain_name } or { domain_id }
   - Uses req.user.id when available; falls back to intern_id
   - Inserts into mentedge.internship_joined and increments join_count
   =========================== */
const joinInternship = async (req, res) => {
  const client = await db.connect();
  try {
    const { internship_id, domain_name, domain_id, intern_id } = req.body;
    const internId = req.user?.id || intern_id;

    if (!internId) {
      return res.status(400).json({ message: "intern_id is required" });
    }

    if (!domain_id && (!internship_id || !domain_name)) {
      return res.status(400).json({
        message: "Provide domain_id or internship_id + domain_name",
      });
    }

    await client.query("BEGIN");

    let domainQuery;
    let domainParams;
    if (domain_id) {
      domainQuery = `
        SELECT id, internship_id, max_seats, join_count
        FROM mentedge.internship_domains
        WHERE id = $1
        FOR UPDATE
      `;
      domainParams = [domain_id];
    } else {
      domainQuery = `
        SELECT id, internship_id, max_seats, join_count
        FROM mentedge.internship_domains
        WHERE internship_id = $1 AND domain_name = $2
        FOR UPDATE
      `;
      domainParams = [internship_id, domain_name];
    }

    const dRes = await client.query(domainQuery, domainParams);
    if (dRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Domain not found" });
    }

    const domain = dRes.rows[0];
    if (domain.max_seats !== null && domain.join_count >= domain.max_seats) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ message: "No seats available for this domain" });
    }

    if (internship_id && domain.internship_id !== internship_id) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ message: "Domain does not match internship" });
    }

    const checkRes = await client.query(
      `
      SELECT 1
      FROM mentedge.internship_joined
      WHERE intern_id = $1 AND domain_id = $2
      `,
      [internId, domain.id]
    );

    if (checkRes.rowCount > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Already joined this domain" });
    }

    await client.query(
      `
      INSERT INTO mentedge.internship_joined (intern_id, internship_id, domain_id)
      VALUES ($1, $2, $3)
      `,
      [internId, domain.internship_id, domain.id]
    );

    await client.query(
      `
      UPDATE mentedge.internship_domains
      SET join_count = join_count + 1
      WHERE id = $1
      `,
      [domain.id]
    );

    await client.query("COMMIT");
    return res.json({ success: true, message: "Joined domain successfully" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("joinInternship error:", err);
    return res.status(500).json({ error: "Failed to join domain" });
  } finally {
    client.release();
  }
};

/* ===========================
   Get joined internships for an intern (domain aware)
   returns joined records with internship + domain info
   =========================== */
const getJoinedInternships = async (req, res) => {
  try {
    const internId = req.user?.id || req.params.internId;

    if (!internId) {
      return res.status(400).json({ error: "internId is required" });
    }

    const result = await db.query(
      `SELECT
         j.id,
         j.intern_id,
         j.internship_id,
         j.domain_id,
         j.joined_at,
         j.updated_at,
         i.internship_title,
         i.description,
         i.price,
         i.status,
         i.approval_required,
         i.created_at,
         d.domain_name,
         d.domain_title,
         d.domain_description,
         d.start_date,
         d.end_date,
         d.duration,
         d.weekly_hours,
         d.application_deadline,
         d.difficulty_level,
         d.marketplace_category,
         d.max_seats,
         d.join_count,
         d.seats_left
       FROM mentedge.internship_joined j
       JOIN mentedge.internships i ON i.id = j.internship_id
       LEFT JOIN mentedge.internship_domains d ON d.id = j.domain_id
       WHERE j.intern_id = $1
       ORDER BY j.joined_at DESC NULLS LAST`,
      [internId]
    );

    return res.json(result.rows);
  } catch (err) {
    console.error("getJoinedInternships error:", err);
    return res
      .status(500)
      .json({ error: "Failed to fetch joined internships" });
  }
};

/* ===========================
   Get ongoing internships for an intern (domain-aware)
   Fetches domain records where current_date between domain start/end for domains the intern joined
   =========================== */
const getOngoingInternships = async (req, res) => {
  try {
    const internId = req.user?.id || req.params.internId;

    if (!internId) {
      return res.status(400).json({ error: "internId is required" });
    }

    const result = await db.query(
      `SELECT
         j.id AS joined_id,
         j.joined_at,
         i.id AS internship_id,
         i.internship_title,
         i.description,
         i.price,
         i.status,
         i.approval_required,
         i.created_at,
         d.id AS domain_id,
         d.domain_name,
         d.domain_title,
         d.domain_description,
         d.start_date,
         d.end_date,
         d.duration,
         d.weekly_hours,
         d.application_deadline,
         d.difficulty_level,
         d.marketplace_category,
         d.max_seats,
         d.join_count,
         d.seats_left
       FROM mentedge.internship_joined j
       JOIN mentedge.internship_domains d ON d.id = j.domain_id
       JOIN mentedge.internships i ON i.id = j.internship_id
       WHERE j.intern_id = $1
       AND CURRENT_DATE BETWEEN d.start_date AND d.end_date
       ORDER BY d.start_date ASC`,
      [internId]
    );

    return res.json(result.rows);
  } catch (err) {
    console.error("getOngoingInternships error:", err);
    return res
      .status(500)
      .json({ error: "Failed to fetch ongoing internships" });
  }
};

const getOngoingInternshipsWithProgress = async (req, res) => {
  try {
    const internId = req.user?.id;

    if (!internId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const result = await db.query(
      `
      SELECT
        j.id AS joined_id,
        j.joined_at,
        i.id AS internship_id,
        i.internship_title,
        i.description,
        i.price,
        i.status,
        i.approval_required,
        i.created_at,
        d.id AS domain_id,
        d.domain_name,
        d.domain_title,
        d.domain_description,
        d.start_date,
        d.end_date,
        d.duration,
        d.weekly_hours,
        d.application_deadline,
        d.difficulty_level,
        d.marketplace_category,
        d.max_seats,
        d.join_count,
        d.seats_left,
        w.id AS workboard_id,
        COALESCE(p.concepts_total, 0) AS concepts_total,
        COALESCE(p.concepts_completed, 0) AS concepts_completed,
        COALESCE(p.tasks_total, 0) AS tasks_total,
        COALESCE(p.tasks_assigned, 0) AS tasks_assigned,
        COALESCE(p.tasks_completed, 0) AS tasks_completed,
        COALESCE(p.assignments_total, 0) AS assignments_total,
        COALESCE(p.assignments_assigned, 0) AS assignments_assigned,
        COALESCE(p.assignments_submitted, 0) AS assignments_submitted,
        COALESCE(p.assignments_graded, 0) AS assignments_graded,
        COALESCE(
          p.concepts_completed
          + p.tasks_completed
          + p.assignments_submitted,
          0
        ) AS completed_items,
        COALESCE(
          p.concepts_total
          + p.tasks_assigned
          + p.assignments_assigned,
          0
        ) AS total_items,
        CASE
          WHEN COALESCE(
            p.concepts_total
            + p.tasks_assigned
            + p.assignments_assigned,
            0
          ) > 0
          THEN ROUND(
            (
              (
                p.concepts_completed
                + p.tasks_completed
                + p.assignments_submitted
              )::numeric
              * 100
            )
            / (
              p.concepts_total
              + p.tasks_assigned
              + p.assignments_assigned
            ),
            2
          )
          ELSE 0
        END AS progress_percent
      FROM mentedge.internship_joined j
      JOIN mentedge.internship_domains d ON d.id = j.domain_id
      JOIN mentedge.internships i ON i.id = j.internship_id
      LEFT JOIN mentedge.workboards w
        ON w.internship_id = j.internship_id
       AND w.domain_name = d.domain_name
      LEFT JOIN LATERAL (
        WITH milestones AS (
          SELECT id FROM mentedge.milestones WHERE workboard_id = w.id
        ),
        concepts AS (
          SELECT c.id
          FROM mentedge.concepts c
          JOIN milestones m ON m.id = c.milestone_id
        ),
        tasks AS (
          SELECT t.id, t.assigned_to
          FROM mentedge.tasks t
          JOIN milestones m ON m.id = t.milestone_id
        ),
        assignments AS (
          SELECT a.id
          FROM mentedge.assignments a
          JOIN milestones m ON m.id = a.milestone_id
        ),
        task_assigned AS (
          SELECT DISTINCT t.id
          FROM tasks t
          LEFT JOIN mentedge.task_assignments ta
            ON ta.task_id = t.id AND ta.intern_id = $1
          WHERE ta.intern_id IS NOT NULL
            OR t.assigned_to = $1
            OR NOT EXISTS (
              SELECT 1 FROM mentedge.task_assignments ta2 WHERE ta2.task_id = t.id
            )
        ),
        assignment_assigned AS (
          SELECT DISTINCT a.id
          FROM assignments a
          LEFT JOIN mentedge.assignment_assignments aa
            ON aa.assignment_id = a.id AND aa.intern_id = $1
          WHERE aa.intern_id IS NOT NULL
            OR NOT EXISTS (
              SELECT 1
              FROM mentedge.assignment_assignments aa2
              WHERE aa2.assignment_id = a.id
            )
        )
        SELECT
          (SELECT COUNT(*) FROM concepts) AS concepts_total,
          (SELECT COUNT(*)
           FROM concepts c
           JOIN mentedge.concept_progress cp
             ON cp.concept_id = c.id AND cp.intern_id = $1
           WHERE cp.status = 'completed'
          ) AS concepts_completed,
          (SELECT COUNT(*) FROM tasks) AS tasks_total,
          (SELECT COUNT(*) FROM task_assigned) AS tasks_assigned,
          (SELECT COUNT(*)
           FROM task_assigned ta
           JOIN mentedge.task_progress tp
             ON tp.task_id = ta.id AND tp.intern_id = $1
           WHERE tp.status = 'done'
          ) AS tasks_completed,
          (SELECT COUNT(*) FROM assignments) AS assignments_total,
          (SELECT COUNT(*) FROM assignment_assigned) AS assignments_assigned,
          (SELECT COUNT(*)
           FROM assignments a
           JOIN mentedge.assignment_submissions s
             ON s.assignment_id = a.id AND s.intern_id = $1
           WHERE s.status <> 'not_started'
          ) AS assignments_submitted,
          (SELECT COUNT(*)
           FROM assignments a
           JOIN mentedge.assignment_submissions s
             ON s.assignment_id = a.id AND s.intern_id = $1
           WHERE s.status = 'graded'
          ) AS assignments_graded
      ) p ON true
      WHERE j.intern_id = $1
        AND CURRENT_DATE BETWEEN d.start_date AND d.end_date
      ORDER BY d.start_date ASC
      `,
      [internId]
    );

    return res.status(200).json(result.rows);
  } catch (err) {
    console.error("getOngoingInternshipsWithProgress error:", err);
    return res
      .status(500)
      .json({ message: "Failed to fetch ongoing internships" });
  }
};

const rejectInternship = async (req, res) => {
  const client = await db.connect();
  try {
    const { internshipId } = req.params;
    const mentorId = req.user?.id;

    await client.query("BEGIN");

    if (mentorId) {
      const hostCheck = await client.query(
        `
        SELECT 1
        FROM mentedge.internship_hosts
        WHERE internship_id = $1 AND mentor_id = $2 AND role = 'host'
        `,
        [internshipId, mentorId]
      );

      if (hostCheck.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(403).json({ message: "Only host can reject" });
      }
    }

    const result = await client.query(
      `
      UPDATE mentedge.internships
      SET status = 'rejected'
      WHERE id = $1
      RETURNING *
      `,
      [internshipId]
    );

    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Internship not found" });
    }

    await client.query("COMMIT");
    return res.json({
      success: true,
      message: "Internship rejected successfully",
      internship: result.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("rejectInternship error:", err);
    return res.status(500).json({ error: "Failed to reject internship" });
  } finally {
    client.release();
  }
};



module.exports = {
  createAssignment,
  createConcept,
  createTask,
  createMilestone,
  updateConcept,
  updateTask,
  updateAssignment,
  createInternship,
  getAllInternships,
  getInternshipById,
  updateInternship,
  deleteInternship,
  openForCohost,
  approveAndPost,
  sendToHost,
  getInternshipsByFilter,
  joinInternship,
  getJoinedInternships,
  getOngoingInternships,
  getCurrentMentorInternships,
  getScheduledMentorInternships,
  getOngoingMentorInternships,
  getCurrentRequestedInternships,
  submitCohostDomain,
  respondCohostInvite,
  getInternshipsByStatus,
  getCurrentMentorWorkboard,
  getInternWorkboard,
  getDomainInterns,
  uploadConceptFiles,
  getConceptFiles,
  deleteConceptFile,
  upsertConceptProgress,
  upsertTaskProgress,
  getInternPerformance,
  submitAssignment,
  submitAssignmentFiles,
  uploadAssignmentFiles,
  getAssignmentFiles,
  deleteAssignmentFile,
  gradeAssignment,
  getAvailableInternshipsForIntern,
  getOngoingInternshipsWithProgress,
};
