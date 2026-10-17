# Computer Use pilot runbook

Use this runbook to grant one Roster agent tightly scoped control of a laptop
application through the ChatGPT desktop app's managed Computer Use plugin.
It is not a procedure for unrestricted desktop access.

## 1. Authorize the boundary

Do not install or enable the pilot until the laptop owner records all fields.

| Field | Pilot value |
| --- | --- |
| Laptop owner and approver | _Required_ |
| Operating system and version | _Required: macOS or Windows_ |
| ChatGPT workspace/account | _Required_ |
| Named Roster agent | _Required_ |
| One allowed desktop app | _Required; low-risk only_ |
| Exact task | _Required; read-only or reversible_ |
| Success criteria | _Required and observable_ |
| Start / expiry time | _Required_ |
| Safety/release reviewer | _Required before expansion_ |

Suitable first tasks include inspecting a non-sensitive preference, reproducing
a non-destructive UI issue, or drafting content without sending it. Do not use
a pilot task involving credentials, payments, submissions, account/security or
privacy settings, network settings, or sensitive data.

If the target offers a dedicated plugin or MCP integration for the required
data or repeatable action, use that structured integration instead. Use
Computer Use only when the graphical interface itself must be inspected or
operated.

## 2. Install and enable

The laptop owner performs these actions in the ChatGPT desktop app:

1. Select **Work** or **Codex**, open **Plugins**, and install **Computer Use**
   if it is not already installed.
2. Select **Enable** if shown, enable the Computer Use server and skill, then
   select **Try now**.
3. Open **Settings > Computer use** and confirm that no unrelated app is
   listed as always allowed.
4. On macOS, grant Screen Recording and Accessibility only when prompted for
   Computer Use. These permissions respectively allow the feature to see and
   to click/type/navigate in an approved app.
5. On Windows, make sure the allowed app can remain visible on the active
   desktop for the whole test. Computer Use operates the foreground session;
   do not use that desktop concurrently.

If a workspace administrator restricts Computer Use or saved approvals, obtain
the administrator's decision before proceeding. Do not work around a managed
policy.

## 3. Run the supervised test

1. Close unrelated or sensitive applications and windows.
2. Start a task with `@Computer` (or the allowed app name), naming the one app,
   the exact task, and the expected result. Example:

   ```text
   @Computer Use only [allowed app] to [reversible task].
   Ask before sending, submitting, changing settings, or leaving this app.
   Stop after [observable success criterion].
   ```

3. When Computer Use asks to use the app, choose **Allow**. Do **not** select
   **Always allow** during the pilot.
4. The laptop owner watches each permission prompt and stays present for any
   action that could send, submit, change, disclose, or delete information.
5. Test stop/takeover once before the task completes. On macOS, local keyboard
   or pointer input can interrupt the task; on either OS, stop the task if it
   targets the wrong window.
6. Confirm that no other app was accessed and that the stated success criterion
   was met.

## 4. Capture evidence and review

Record the following in the associated task or change review:

* the completed boundary table;
* the prompt used and time of the test;
* every app-access and sensitive-action prompt observed;
* result against the success criteria;
* whether stop/takeover worked;
* any unexpected window, app, or data exposure; and
* the safety/release reviewer's expansion or rollback decision.

Move the work to review only after this evidence is available. Expand access
only by repeating the pilot for one additional named application. Persistent
access requires the reviewer to approve that exact application.

## 5. Roll back

For any unexpected behavior, stop the task immediately, remove the app from
**Settings > Computer use**, and record the incident for review. If Computer
Use is no longer needed on macOS, remove its Screen Recording and Accessibility
permissions in **System Settings > Privacy & Security**. Remove any saved
allow-list entry before considering a new pilot.

## References

* [OpenAI: Computer Use](https://learn.chatgpt.com/docs/computer-use)
* [OpenAI: Use your computer with Codex](https://learn.chatgpt.com/use-cases/use-your-computer-with-codex)
