from uuid import uuid4


def new_id() -> str:
    return uuid4().hex


def work_item_key(sequence: int) -> str:
    return f"ROS-{sequence}"
