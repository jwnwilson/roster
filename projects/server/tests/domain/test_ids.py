from domain.ids import new_id, work_item_key


def test_new_id_is_32_char_hex():
    # Act
    value = new_id()

    # Assert
    assert len(value) == 32
    assert all(character in "0123456789abcdef" for character in value)


def test_new_id_is_unique_across_calls():
    assert new_id() != new_id()


def test_work_item_key_uses_the_ros_prefix():
    assert work_item_key(42) == "ROS-42"
